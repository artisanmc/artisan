package net.artisanmc.plugin

import net.artisanmc.plugin.assistant.ImportSourceReader
import net.artisanmc.modules.api.*
import net.artisanmc.plugin.scheduling.Scheduler
import net.artisanmc.plugin.scheduling.schedulerFor
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.modules.commands.CommandsModule
import net.artisanmc.modules.menus.MenusModule
import net.artisanmc.plugin.command.CommandRegistrar
import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.provider.SyncedMenuProvider
import com.github.retrooper.packetevents.PacketEvents
import io.github.retrooper.packetevents.factory.spigot.SpigotPacketEventsBuilder
import net.artisanmc.plugin.render.ClientSlotSink
import net.artisanmc.plugin.render.MenuListener
import net.artisanmc.plugin.render.MenuWindows
import net.artisanmc.plugin.render.PacketEventsMenuPackets
import net.artisanmc.plugin.render.PacketEventsSlotSink
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set
    val scheduler: Scheduler by lazy { schedulerFor(this) }

    /**
     * Reprise de l'instantané demandée par un Add-on (`api.project.reload()`).
     *
     * Silencieuse avant que le provider n'existe : un module qui écrit pendant
     * son propre `onEnable` n'a rien à reprendre — le chargement qui suit lira
     * son disque de toute façon.
     */
    fun refreshProjectsFromDisk() {
        if (!::menuProvider.isInitialized) return
        (menuProvider as? net.artisanmc.plugin.provider.SyncedMenuProvider)?.refreshFromDisk()
    }
    private lateinit var artisanCommand: ArtisanCommand
    private lateinit var executor: ActionExecutor
    private lateinit var sessions: MenuSessionStore
    private lateinit var navigationHistory: NavigationHistoryStore
    private lateinit var menuWindows: MenuWindows
    /** Survives `/artisan reload`: the pack manager is swapped, the players' loaded packs are not. */
    private val packLoads = net.artisanmc.plugin.resourcepack.PackLoadTracker()
    private val openedContainers = net.artisanmc.plugin.render.OpenedContainers()
    private var packetEventsLoaded = false
    private lateinit var cooldowns: CooldownStore
    private lateinit var evaluator: ConditionEvaluator
    private lateinit var commandRegistrar: CommandRegistrar
    /** Exposed for /artisan dump-title diagnostics. */
    lateinit var assetCatalog: net.artisanmc.plugin.resourcepack.AssetCatalog
        private set
    lateinit var langManager: LangManager
    lateinit var capturedItems: net.artisanmc.plugin.items.CapturedItemStore
    /** projectId -> working-copy root, unioning the core projects dir with Add-on-owned roots. */
    lateinit var projectRoots: net.artisanmc.plugin.project.ProjectRoots
        private set
    /** Late-bound WS sender for module messages (api.messages) — set once the provider exists. */
    @Volatile var moduleMessageSender: ((Map<String, Any>) -> Unit)? = null
        private set
    /** The event-registered resource-pack manager — swapped (not stacked) on `/artisan reload`. */
    @Volatile
    private var resourcePackManager: net.artisanmc.plugin.resourcepack.ResourcePackManager? = null
    lateinit var api: ArtisanAPI
        private set
    /** Connexions à l'éditeur : survivent à `/artisan reload`, pas au redémarrage. */
    val editorSessions = net.artisanmc.plugin.hub.Sessions()
    private val editorChannel by lazy { net.artisanmc.plugin.hub.EditorChannel(logger) }
    /** Null si `web.enabled` est faux ou si le port n'a pas pu être ouvert. */
    @Volatile var editor: net.artisanmc.plugin.hub.HubServer? = null
        private set
    /** Adresse publique de l'éditeur, configurée dans `web.url` ; vide si non renseignée. */
    var editorUrl: String = ""
        private set
    private var editorBind: String = ""
    /** Pools lent through `api.database` (ADR `suite-foundation-database`). */
    lateinit var database: net.artisanmc.plugin.database.PooledDatabase
        private set

    companion object {
        fun defaultModules(): List<ArtisanModule> = listOf(
            MenusModule(),
            CommandsModule(),
        )

        fun buildApi(plugin: ArtisanPlugin): ArtisanAPI {
            val registry = ModuleRegistry()
            val nexoForCapture = net.artisanmc.plugin.engine.NexoItemRenderer.tryInit()
            plugin.projectRoots = net.artisanmc.plugin.project.ProjectRoots(File(plugin.dataFolder, "projects"), plugin.logger)
            plugin.database = net.artisanmc.plugin.database.PooledDatabase(plugin::databaseSettings, plugin.logger)
            val api = ArtisanAPI(
                plugin = plugin,
                dataSources = DataSourceRegistry(),
                commands = CommandRegistry(),
                events = ModuleEventBus(),
                schemas = SchemaRegistry(),
                modules = registry,
                coreVersion = plugin.description.version,
                // Le provider naît plus tard (il a besoin de l'API) : la reprise
                // se résout à l'appel, pas à la construction.
                project = net.artisanmc.plugin.project.ProjectContentReader(plugin.projectRoots) {
                    plugin.refreshProjectsFromDisk()
                },
                projectRoots = plugin.projectRoots,
                database = plugin.database,
                items = object : net.artisanmc.modules.api.ItemStackApi {
                    override fun serialize(stack: org.bukkit.inventory.ItemStack): String =
                        net.artisanmc.plugin.items.ItemDescriptor.serialize(stack)
                    override fun describe(stack: org.bukkit.inventory.ItemStack): Map<String, Any> =
                        net.artisanmc.plugin.items.ItemDescriptor.derive(stack, nexoForCapture)
                },
                messages = object : net.artisanmc.modules.api.ModuleMessagesApi {
                    override fun send(type: String, payload: Map<String, Any?>) {
                        val m = HashMap<String, Any>()
                        m["type"] = type
                        payload.forEach { (k, v) -> if (v != null) m[k] = v }
                        val sender = plugin.moduleMessageSender
                        if (sender != null) sender(m)
                        else plugin.logger.warning("[Artisan] module message '$type' dropped — not connected")
                    }
                },
                actions = object : net.artisanmc.modules.api.ModuleActionsApi {
                    override fun execute(
                        player: org.bukkit.entity.Player,
                        actions: String,
                        args: Map<String, Any>,
                        projectId: String?,
                    ) {
                        if (actions.isBlank()) return
                        val run = Runnable {
                            val parsed = try {
                                net.artisanmc.plugin.actiondsl.dslToEngineSteps(
                                    net.artisanmc.plugin.actiondsl.parseActionDsl(actions),
                                )
                            } catch (e: Exception) {
                                plugin.logger.warning("[Artisan] module actions skipped — malformed DSL: ${e.message}")
                                return@Runnable
                            }
                            if (!plugin::executor.isInitialized) {
                                plugin.logger.warning("[Artisan] module actions dropped — engine not initialized")
                                return@Runnable
                            }
                            // Portée i18n du project : sans elle une action
                            // portant `@clé` afficherait « {i18n:clé} » brut.
                            val lang =
                                if (plugin::langManager.isInitialized) plugin.langManager.playerLang(player)
                                else "en"
                            val bundles =
                                if (plugin::menuProvider.isInitialized) plugin.menuProvider.allBundles()
                                else emptyList()
                            val langMap =
                                net.artisanmc.plugin.provider.projectLangMap(bundles, projectId, lang)
                            plugin.executor.executeSteps(
                                parsed,
                                net.artisanmc.plugin.engine.ExecutionContext(
                                    player = player,
                                    args = args,
                                    lang = lang,
                                    langMap = langMap,
                                    projectId = projectId,
                                ),
                            )
                        }
                        plugin.scheduler.onPlayer(player.uniqueId, run::run)
                    }
                },
            )
            // version = core plugin version for now (ArtisanModule has no own version); P1c will add ArtisanModule.version
            registry.bind(api) {
                if (plugin::menuProvider.isInitialized) {
                    (plugin.menuProvider as? SyncedMenuProvider)?.notifyModulesChanged(
                        registry.active().map { mapOf("id" to it.id, "version" to plugin.description.version) },
                    )
                }
            }
            return api
        }
    }

    /** Appelé depuis les threads d'I/O du provider : la command map n'est sûre que sur le thread global. */
    private fun applyReload() {
        capturedItems.reload()
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
        api.modules.active().forEach { runCatching { it.onReload() } }
        api.events.publish(ConfigReloadEvent(moduleId = "menus"))
    }

    /** PacketEvents est intégré au jar (relocalisé) : chargé ici, initialisé en tête d'[onEnable]. */
    override fun onLoad() {
        packetEventsLoaded = runCatching {
            PacketEvents.setAPI(SpigotPacketEventsBuilder.build(this))
            PacketEvents.getAPI().settings.checkForUpdates(false).bStats(false)
            PacketEvents.getAPI().load()
        }.onFailure { logger.log(java.util.logging.Level.SEVERE, "PacketEvents failed to load — menus will open empty", it) }.isSuccess
    }

    override fun onEnable() {
        // Le contenu des menus ne part que par paquets : sans PacketEvents,
        // les fenêtres s'ouvrent vides (clics et sessions restent actifs).
        val packets = packetEventsLoaded && runCatching { PacketEvents.getAPI().init() }
            .onFailure { logger.log(java.util.logging.Level.SEVERE, "PacketEvents failed to start — menus will open empty", it) }
            .isSuccess
        menuWindows = MenuWindows(
            if (packets) PacketEventsSlotSink { menuWindows.get(it.uniqueId)?.stateId ?: 0 } else ClientSlotSink.None,
        )
        if (packets) {
            val chestTexture = net.artisanmc.plugin.render.VanillaGuiTitle.Rule(
                menuWindows,
                { id, texture ->
                    packLoads.hasLoaded(id) && ::assetCatalog.isInitialized && texture in assetCatalog.transparentTextures
                },
                openedContainers::typeOf,
            )
            PacketEventsMenuPackets(menuWindows, chestTexture).register()
        }
        server.pluginManager.registerEvents(packLoads, this)
        server.pluginManager.registerEvents(openedContainers, this)
        saveDefaultConfig()
        api = buildApi(this)
        server.servicesManager.register(ArtisanAPI::class.java, api, this, org.bukkit.plugin.ServicePriority.Normal)
        server.pluginManager.registerEvents(database, this)
        val cfg = loadPluginConfig()
        cfg.assistantImportSourceWarnings.forEach { logger.warning("[assistant] $it") }
        projectRoots.coreRoot.mkdirs()

        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)

        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        navigationHistory = NavigationHistoryStore()
        // Disk-cached asset index: glyph/font titles keep rendering with the
        // backend down or gone (offline completeness — the catalog was
        // previously HTTP-only and booted empty offline).
        assetCatalog = net.artisanmc.plugin.resourcepack.AssetCatalog(
            cacheFile = java.io.File(dataFolder, "cache/asset-index.json"),
        )
        assetCatalog.loadFromDisk()
        commandRegistrar = CommandRegistrar(this, langManager)

        // Les modules s'inscrivent avant le premier `hello`, qui les annonce.
        startRuntime(cfg) { defaultModules().forEach { api.modules.register(it) } }
        registerCustomItemsReloadListeners()
        startEditor(cfg.web)

        artisanCommand = ArtisanCommand(this, langManager)
        getCommand("artisan")?.setExecutor(artisanCommand)
        getCommand("artisan")?.tabCompleter = artisanCommand
        server.pluginManager.registerEvents(MenuListener(this, sessions, executor, menuWindows, history = navigationHistory), this)
        logger.info("Artisan ${description.version} enabled")
    }

    override fun onDisable() {
        stopEditor()
        api.modules.active().forEach { runCatching { it.onDisable() } }
        if (::database.isInitialized) database.closeAll()
        artisanCommand.shutdown()
        commandRegistrar.unregisterAll()
        menuProvider.shutdown()
        if (packetEventsLoaded) runCatching { PacketEvents.getAPI().terminate() }
        logger.info("Artisan disabled")
    }

    /** Le serveur vu par l'éditeur qu'il sert : toujours le provider courant, qui change à chaque reload. */
    private val localServer = object : net.artisanmc.plugin.hub.EditorServer {
        private val provider get() = menuProvider as SyncedMenuProvider
        override val id = net.artisanmc.plugin.hub.Servers.LOCAL
        override val online = true
        override val link: net.artisanmc.plugin.protocol.ServerLink get() = provider.link
        override val label: String get() = File(".").absoluteFile.normalize().name.ifBlank { "Minecraft" }
        override val minecraftVersion: String get() = provider.minecraftVersion
        override val pluginVersion: String get() = description.version
        override fun modules() = api.modules.active().map { mapOf("id" to it.id, "version" to description.version) }
        override fun dataSources() = net.artisanmc.plugin.ws.DataSourceReport.build(api.dataSources)
        override fun models() = api.models.declared().map { it.document }
        override fun screens() = api.screens.declared().map { it.toWire() }
        override fun serverConfig() = serverConfigAccess.report()
        override fun customItems() = provider.customItems()
        override fun applyResourcePack(hash: String, path: String) {
            val port = editor?.port ?: return
            val local = editorBind.takeUnless { it.isBlank() || it == "0.0.0.0" } ?: "127.0.0.1"
            val base = editorUrl.ifEmpty { "http://${server.ip.ifBlank { "localhost" }}:$port" }
            provider.applyLocalResourcePack("$base$path", "http://$local:$port$path", hash)
        }
    }

    internal fun stopEditor() {
        editor?.stop()
        editor = null
    }

    /** Jetty vient de `libraries:` : s'il manque (serveur sans accès sortant), le plugin tourne sans éditeur. */
    private fun startEditor(web: net.artisanmc.plugin.hub.WebConfig) {
        editorUrl = web.url
        editorBind = web.bind
        if (!web.enabled) return
        try {
            val vanilla = net.artisanmc.plugin.hub.VanillaAssets(File(dataFolder, "cache/minecraft"), localServer.minecraftVersion, logger)
            val packs = net.artisanmc.plugin.hub.PackStore(File(dataFolder, "cache/resource-pack"))
            val router = net.artisanmc.plugin.hub.EditorApi.router(net.artisanmc.plugin.hub.Servers(localServer), editorSessions, logger, vanilla, packs)
            val server = net.artisanmc.plugin.hub.HubServer(
                web, router, editorSessions, net.artisanmc.plugin.hub.EditorAssets(javaClass.classLoader), editorChannel, logger,
            )
            if (server.start()) editor = server
        } catch (e: LinkageError) {
            logger.warning("[Artisan] Editor disabled: web server libraries are missing (${e.message})")
        }
    }

    /**
     * Enregistrés une seule fois : chaque événement vise le provider courant, pour qu'un
     * `/artisan reload` n'empile pas un écouteur de plus par rechargement.
     */
    private fun registerCustomItemsReloadListeners() {
        val mgr = server.pluginManager
        val notify = { scheduler.async { (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload() } }

        // Initial custom items hash sync, post-server-load.
        // Runs regardless of which custom-items plugin is installed.
        // Short delay (40 ticks ≈ 2 s) lets Nexo/Oraxen/ItemsAdder finish populating
        // their item registries and the WS hello to settle before we push the hash.
        // notifyCustomItemsReload itself runs on a Bukkit async worker.
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: org.bukkit.event.server.ServerLoadEvent) {
                scheduler.asyncLater(40L) {
                    (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload()
                    // Un module qui écrit dans son project à l'activation n'a plus
                    // rien à rattraper : le disque est la seule vérité, donc son
                    // fichier est déjà en place (ADR `server-disk-only-storage`).
                    // Avant, il fallait rejouer le contrôle de synchro du hello_ack,
                    // sinon le sweep du bundle suivant effaçait le fichier.
                }
            }
        }, this)

        if (mgr.getPlugin("Nexo") != null) {
            // Hot-reload listener: fires on /nexo reload during runtime
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: com.nexomc.nexo.api.events.NexoItemsLoadedEvent) {
                    notify()
                }
            }, this)
        }

        if (mgr.getPlugin("Oraxen") != null) {
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: io.th0rgal.oraxen.api.events.OraxenItemsLoadedEvent) {
                    notify()
                }
            }, this)
        }

        if (mgr.getPlugin("ItemsAdder") != null) {
            try {
                @Suppress("UNCHECKED_CAST")
                val eventClass = Class.forName("dev.lone.itemsadder.api.Events.CustomItemsLoadedEvent")
                    as Class<out org.bukkit.event.Event>
                mgr.registerEvent(
                    eventClass,
                    object : org.bukkit.event.Listener {},
                    org.bukkit.event.EventPriority.NORMAL,
                    { _, event ->
                        if (eventClass.isInstance(event)) {
                            notify()
                        }
                    },
                    this,
                )
            } catch (_: Exception) {
                logger.warning("ItemsAdder found but could not register hot-reload listener")
            }
        }
    }

    /** Test-only seam: swap in a fake [MenuProvider] after onEnable has run. */
    internal fun setMenuProviderForTesting(provider: MenuProvider) {
        menuProvider = provider
    }

    /** Pose le dernier JAR signé dans `plugins/update/` : Paper l'applique au prochain démarrage. */
    private fun pluginUpdater(cfg: PluginConfig): () -> net.artisanmc.plugin.update.PluginUpdater.Result {
        val updater = net.artisanmc.plugin.update.PluginUpdater(
            cfg.httpBaseUrl, cfg.serverKey, description.version, java.io.File(server.updateFolderFile, file.name),
        )
        return updater::install
    }

    val environmentFile: File get() = File(dataFolder, "environment.yml")

    /** Called on the main thread; reloads on the next tick, once the reply is sent. */
    private val serverConfigAccess = object : net.artisanmc.plugin.config.ServerConfigAccess {
        private fun editable() = net.artisanmc.plugin.config.EditableConfig(config.defaults ?: config)
        override fun report() = editable().report(config)
        override fun write(changes: Map<String, Any?>): String? {
            editable().apply(config, changes)?.let { return it }
            saveConfig()
            scheduler.global { reinit(loadPluginConfig()) }
            return null
        }
    }

    /** Re-reads `config.yml` + `environment.yml` (ADRs `server-config-from-editor`, `suite-foundation-database`). */
    fun loadPluginConfig(): PluginConfig {
        net.artisanmc.plugin.config.EnvironmentFile.prepare(
            File(dataFolder, "config.yml"), File(dataFolder, "connection.yml"), environmentFile,
        )
        reloadConfig()
        return currentConfig()
    }

    fun databaseSettings(): net.artisanmc.plugin.database.DatabaseSettings =
        net.artisanmc.plugin.database.readDatabaseSettings(
            org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(environmentFile), config, dataFolder,
        ) { logger.warning("[database] environment variable $it is not set (environment.yml)") }

    fun currentConfig(): PluginConfig =
        PluginConfig.from(config, org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(environmentFile))

    fun reinit(cfg: PluginConfig) {
        cfg.assistantImportSourceWarnings.forEach { logger.warning("[assistant] $it") }
        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)
        menuProvider.unload()
        startRuntime(cfg)
        // ServerLoadEvent est passé : l'empreinte des custom items part d'ici, une fois
        // la nouvelle connexion établie.
        scheduler.asyncLater(40L) { (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload() }
    }

    /**
     * Ce que `/artisan reload` reconstruit depuis la config : items capturés,
     * provider et sa connexion, pack de ressources, moteur d'actions, commandes.
     * [beforeLoad] s'exécute une fois le provider créé, avant sa connexion.
     */
    private fun startRuntime(cfg: PluginConfig, beforeLoad: () -> Unit = {}) {
        projectRoots.coreRoot.mkdirs()
        capturedItems = net.artisanmc.plugin.items.CapturedItemStore(projectRoots, logger)
        capturedItems.reload()
        val softDeps = SoftDepRegistry(this, capturedItems)
        evaluator = ConditionEvaluator(softDeps, cooldowns)

        val provider = createProvider(cfg)
        menuProvider = provider
        moduleMessageSender = { m -> provider.sendModuleMessage(m) }
        beforeLoad()
        // Avant load() : le premier hello porte déjà l'empreinte des custom items. Nexo et
        // Oraxen annoncent leurs items avant qu'Artisan démarre (ordre softdepend).
        val pluginsDir = server.pluginsFolder
        provider.setCustomItemsManager(
            net.artisanmc.plugin.customitems.CustomItemsManager(
                listOf(
                    net.artisanmc.plugin.customitems.NexoSource(pluginsDir),
                    net.artisanmc.plugin.customitems.OraxenSource(pluginsDir),
                    net.artisanmc.plugin.customitems.ItemsAdderSource(pluginsDir),
                ),
            ),
        )
        val packs = net.artisanmc.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
            delegator = packDelegator(cfg),
            cacheFile = java.io.File(dataFolder, "cache/resource-pack.json"),
            packLoads = packLoads,
        )
        // Le dernier pack appliqué survit à un redémarrage pendant une panne du backend.
        packs.loadFromDisk()
        provider.setResourcePackManager(packs)
        registerResourcePackManager(packs)
        provider.load()

        executor = ActionExecutor(this, provider, sessions, softDeps, cooldowns, evaluator, api.commands, navigationHistory)
        commandRegistrar.reload(provider.allBundles(), executor, evaluator)
    }

    private fun createProvider(cfg: PluginConfig) = SyncedMenuProvider(
        roots            = projectRoots,
        serverKey        = cfg.serverKey,
        editorAccessMode = cfg.editorAccessMode,
        wsUrl            = cfg.wsUrl,
        logger           = logger,
        evaluator        = evaluator,
        sessions         = sessions,
        history          = navigationHistory,
        onReload         = { scheduler.onGlobal(::applyReload) },
        executorProvider = { executor },
        lookupAsset      = assetCatalog::lookup,
        offsetEncoderProvider = assetCatalog::offsetEncoder,
        installedModules = { api.modules.active().map { mapOf("id" to it.id, "version" to description.version) } },
        dataSources = api.dataSources,
        dataSourcesReport = { net.artisanmc.plugin.ws.DataSourceReport.build(api.dataSources) },
        declaredModelsReport = { api.models.declared().map { it.document } },
        editorScreensReport = { api.screens.declared().map { it.toWire() } },
        importSources = ImportSourceReader(
            serverRoot = java.io.File(".").toPath(),
            sources = cfg.assistantImportSources,
            logger = logger,
        ),
        scheduler = scheduler,
        menuWindows = menuWindows,
        pluginVersion = description.version,
        pluginUpdater = pluginUpdater(cfg),
        nexoGlyphs = net.artisanmc.plugin.customitems.NexoGlyphReader(java.io.File(server.pluginsFolder, "Nexo")),
        serverConfig = serverConfigAccess,
        editorEvents = { editorChannel.relay(it) },
    )

    /**
     * Délégation du pack à Nexo, Oraxen ou ItemsAdder. Un chemin `.zip` vise un fichier,
     * dont le dossier parent doit être inscriptible ; tout autre chemin vise un dossier.
     * Sinon, repli sur l'envoi direct aux joueurs.
     */
    private fun packDelegator(cfg: PluginConfig): net.artisanmc.plugin.resourcepack.ResourcePackDelegator? {
        val target = File(cfg.resourcePack.delegateToDir ?: return null)
        val checkDir = if (target.name.endsWith(".zip", ignoreCase = true)) target.parentFile ?: target else target
        if (!checkDir.exists()) checkDir.mkdirs()
        if (!checkDir.isDirectory || !checkDir.canWrite()) {
            logger.warning(
                "[delegate] delegate-to-dir ${target.absolutePath} parent " +
                    "(${checkDir.absolutePath}) is not a writable directory — falling back to legacy push mode",
            )
            return null
        }
        logger.info("[delegate] delegation enabled, target dir: ${target.absolutePath}")
        return net.artisanmc.plugin.resourcepack.ResourcePackDelegator(target, logger)
    }

    /**
     * Registers [manager] as the resource-pack event listener, replacing the previous one.
     *
     * Bukkit keeps a listener until the plugin is disabled, and `/artisan reload` re-creates the
     * manager from the freshly read config. Without this swap the stale instance keeps handling
     * joins with the pre-reload settings (duplicate push, and a `resource-pack.enabled: false`
     * that never takes effect).
     */
    private fun registerResourcePackManager(manager: net.artisanmc.plugin.resourcepack.ResourcePackManager) {
        resourcePackManager?.let { org.bukkit.event.HandlerList.unregisterAll(it) }
        server.pluginManager.registerEvents(manager, this)
        resourcePackManager = manager
    }
}
