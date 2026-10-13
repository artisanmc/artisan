package net.artisanmc.plugin

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
     * Snapshot reload requested by an Add-on (`api.project.reload()`).
     *
     * A no-op before the provider exists: a module writing during its own `onEnable`
     * has nothing to reload, the following load reads its disk anyway.
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
    /** Editor sign-ins: survive `/artisan reload`, not a restart. */
    val editorSessions = net.artisanmc.plugin.hub.Sessions()
    private val editorChannel by lazy { net.artisanmc.plugin.hub.EditorChannel(logger) }
    /** Null if `web.enabled` is false or the port could not be opened. */
    @Volatile var editor: net.artisanmc.plugin.hub.HubServer? = null
        private set
    /** The editor's public address from `web.url`; empty when not set. */
    var editorUrl: String = ""
        private set
    private var editorBind: String = ""
    /** `api.menus` listeners, fired with the Bukkit menu events. */
    val menuEvents by lazy { net.artisanmc.plugin.render.MenuEventDispatcher(logger) }
    /** `api.placeholders`: survives `/artisan reload`. */
    val placeholders by lazy { PaperPlaceholders(this) }
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
                // The provider is created later (it needs the API): the reload
                // resolves at call time, not at construction.
                project = net.artisanmc.plugin.project.ProjectContentReader(plugin.projectRoots) {
                    plugin.refreshProjectsFromDisk()
                },
                projectRoots = plugin.projectRoots,
                database = plugin.database,
                menus = net.artisanmc.plugin.provider.PaperMenuApi(
                    provider = { if (plugin::menuProvider.isInitialized) plugin.menuProvider else null },
                    sessions = { if (plugin::sessions.isInitialized) plugin.sessions else null },
                    langOf = { if (plugin::langManager.isInitialized) plugin.langManager.playerLang(it) else "en" },
                    scheduler = plugin.scheduler,
                    events = plugin.menuEvents,
                ),
                scheduler = net.artisanmc.plugin.scheduling.PaperSchedulerApi,
                placeholders = plugin.placeholders,
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
                            // The project's i18n scope: without it an action
                            // carrying `@key` would show a raw "{i18n:key}".
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
            // A module reports the core plugin version: ArtisanModule has no version of its own.
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

    /** Called from the provider's I/O threads, so it is scheduled on the global thread (the command map is only safe there). */
    private fun applyReload() {
        capturedItems.reload()
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
        api.modules.active().forEach { runCatching { it.onReload() } }
        api.events.publish(ConfigReloadEvent(moduleId = "menus"))
    }

    /** PacketEvents is bundled in the jar (relocated): loaded here, initialized at the start of [onEnable]. */
    override fun onLoad() {
        packetEventsLoaded = runCatching {
            PacketEvents.setAPI(SpigotPacketEventsBuilder.build(this))
            PacketEvents.getAPI().settings.checkForUpdates(false).bStats(false)
            PacketEvents.getAPI().load()
        }.onFailure { logger.log(java.util.logging.Level.SEVERE, "PacketEvents failed to load — menus will open empty", it) }.isSuccess
    }

    override fun onEnable() {
        // Menu contents are only sent as packets: without PacketEvents, windows
        // open empty (clicks and sessions stay active).
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
        registerAddonRelease()
        server.pluginManager.registerEvents(database, this)
        val cfg = loadPluginConfig()
        projectRoots.coreRoot.mkdirs()

        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)

        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        navigationHistory = NavigationHistoryStore()
        // Disk-cached asset index: glyph/font titles render from the last pack, even offline.
        assetCatalog = net.artisanmc.plugin.resourcepack.AssetCatalog(
            cacheFile = java.io.File(dataFolder, "cache/asset-index.json"),
        )
        assetCatalog.loadFromDisk()
        commandRegistrar = CommandRegistrar(this, langManager)

        // Modules register before the first `hello`, which announces them.
        startRuntime(cfg) { defaultModules().forEach { api.modules.register(it) } }
        registerCustomItemsReloadListeners()
        startEditor(cfg.web)

        artisanCommand = ArtisanCommand(this, langManager)
        getCommand("artisan")?.setExecutor(artisanCommand)
        getCommand("artisan")?.tabCompleter = artisanCommand
        server.pluginManager.registerEvents(MenuListener(this, sessions, executor, menuWindows, history = navigationHistory, events = menuEvents), this)
        logger.info("Artisan ${description.version} enabled")
    }

    /**
     * What an add-on registered goes away when its plugin disables. The event fires
     * before that plugin's own onDisable: its modules' onDisable still sees it enabled,
     * and a plugin reloader can register the same ids again.
     */
    private fun registerAddonRelease() {
        server.pluginManager.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: org.bukkit.event.server.PluginDisableEvent) {
                if (event.plugin === this@ArtisanPlugin) return
                api.modules.unregisterLoadedBy(event.plugin.javaClass.classLoader).forEach {
                    logger.log(java.util.logging.Level.WARNING, "[Artisan] ${it.message}", it.cause)
                }
            }
        }, this)
    }

    override fun onDisable() {
        stopEditor()
        // Modules of add-ons already went with their plugin (registerAddonRelease).
        api.modules.active().forEach { runCatching { it.onDisable() } }
        if (::database.isInitialized) database.closeAll()
        commandRegistrar.unregisterAll()
        menuProvider.shutdown()
        if (packetEventsLoaded) runCatching { PacketEvents.getAPI().terminate() }
        logger.info("Artisan disabled")
    }

    /** This server as seen by the editor it serves: always the current provider, which changes on each reload. */
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
            provider.applyLocalResourcePack("${editorBase()}$path", "http://$local:$port$path", hash)
        }
    }

    /** The editor address for players and other servers: `web.url`, else [host] or the server IP. */
    private fun editorBase(host: String? = null): String =
        editorUrl.ifEmpty { "http://${host ?: server.ip.ifBlank { "localhost" }}:${editor?.port ?: 8765}" }

    /** This server's name in the network: `web.name`, else its folder name. */
    private fun networkName(web: net.artisanmc.plugin.hub.WebConfig): String =
        web.name.ifBlank { File(".").absoluteFile.normalize().name }.replace(Regex("[^A-Za-z0-9_-]"), "-").take(64)

    private fun networkSecret(web: net.artisanmc.plugin.hub.WebConfig): String =
        net.artisanmc.plugin.config.NetworkSecret.resolve(web.secret, File("."), File(dataFolder, "network-secret"), generate = !web.leaf)

    internal fun stopEditor() {
        editor?.stop()
        editor = null
    }

    /** Jetty comes from `libraries:`: if it is missing (server without outbound access), the plugin runs without the editor. */
    private fun startEditor(web: net.artisanmc.plugin.hub.WebConfig) {
        editorUrl = web.url
        editorBind = web.bind
        if (!web.enabled) return
        if (web.leaf) {
            logger.info("[Artisan] Editor served by the hub at ${web.hubUrl.ifBlank { "(web.hub-url not set)" }}")
            if (databaseSettings().type.equals("h2", ignoreCase = true)) {
                logger.warning("[Artisan] Network mode with an H2 database: each server keeps its own suite data. Use MySQL or MariaDB to share it.")
            }
            return
        }
        try {
            val vanilla = net.artisanmc.plugin.hub.VanillaAssets(File(dataFolder, "cache/minecraft"), localServer.minecraftVersion, logger)
            val packs = net.artisanmc.plugin.hub.PackStore(File(dataFolder, "cache/resource-pack"))
            val servers = net.artisanmc.plugin.hub.Servers(localServer)
            val prefs = net.artisanmc.plugin.hub.PlayerPrefs(File(dataFolder, "editor-prefs"))
            val router = net.artisanmc.plugin.hub.EditorApi.router(servers, editorSessions, logger, vanilla, packs, prefs)
            val plugins = net.artisanmc.plugin.hub.PluginChannel(servers, networkSecret(web), editorSessions, editorChannel, ::editorBase, logger)
            val server = net.artisanmc.plugin.hub.HubServer(
                web, router, editorSessions, net.artisanmc.plugin.hub.EditorAssets(javaClass.classLoader), editorChannel, logger, plugins,
            )
            if (server.start()) editor = server
        } catch (e: LinkageError) {
            logger.warning("[Artisan] Editor disabled: web server libraries are missing (${e.message})")
        }
    }

    /**
     * Registered once: each event targets the current provider, so `/artisan reload`
     * does not stack one more listener per reload.
     */
    private fun registerCustomItemsReloadListeners() {
        val mgr = server.pluginManager
        val notify = { scheduler.async { (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload() } }

        // Initial custom items hash sync, after server load, whichever custom-items plugin
        // is installed. The delay (40 ticks ≈ 2 s) lets Nexo/Oraxen/ItemsAdder finish
        // populating their registries and the WS hello settle before the hash is pushed.
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: org.bukkit.event.server.ServerLoadEvent) {
                scheduler.asyncLater(40L) {
                    (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload()
                }
            }
        }, this)

        if (mgr.getPlugin("Nexo") != null) {
            // Fires on /nexo reload.
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
        net.artisanmc.plugin.config.EnvironmentFile.prepare(environmentFile)
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
        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)
        menuProvider.unload()
        startRuntime(cfg)
        // ServerLoadEvent is past: the custom items hash goes from here, once the new
        // connection is up.
        scheduler.asyncLater(40L) { (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload() }
    }

    /**
     * What `/artisan reload` rebuilds from the config: captured items, the provider and
     * its connection, the resource pack, the action engine, commands.
     * [beforeLoad] runs once the provider exists, before it connects.
     */
    private fun startRuntime(cfg: PluginConfig, beforeLoad: () -> Unit = {}) {
        projectRoots.coreRoot.mkdirs()
        capturedItems = net.artisanmc.plugin.items.CapturedItemStore(projectRoots, logger)
        capturedItems.reload()
        val softDeps = SoftDepRegistry(this, capturedItems, placeholders)
        evaluator = ConditionEvaluator(softDeps, cooldowns)

        val provider = createProvider(cfg)
        menuProvider = provider
        moduleMessageSender = { m -> provider.sendModuleMessage(m) }
        beforeLoad()
        // Before load(): the first hello already carries the custom items hash. Nexo and
        // Oraxen announce their items before Artisan starts (softdepend order).
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
        // The last applied pack survives a restart, even with the hub unreachable.
        packs.loadFromDisk()
        provider.setResourcePackManager(packs)
        registerResourcePackManager(packs)
        provider.load()

        executor = ActionExecutor(this, provider, sessions, softDeps, cooldowns, evaluator, api.commands, navigationHistory)
        commandRegistrar.reload(provider.allBundles(), executor, evaluator)
    }

    private fun createProvider(cfg: PluginConfig) = SyncedMenuProvider(
        roots            = projectRoots,
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
        scheduler = scheduler,
        menuWindows = menuWindows,
        pluginVersion = description.version,
        nexoGlyphs = net.artisanmc.plugin.customitems.NexoGlyphReader(java.io.File(server.pluginsFolder, "Nexo")),
        serverConfig = serverConfigAccess,
        editorEvents = { editorChannel.relay(it) },
        hub = hubLink(cfg.web),
        menuEvents = menuEvents,
    )

    /** Only a leaf opens a WebSocket: to `web.hub-url`, with the network secret. */
    private fun hubLink(web: net.artisanmc.plugin.hub.WebConfig): net.artisanmc.plugin.ws.HubLink? {
        if (!web.leaf || web.hubUrl.isBlank()) return null
        val secret = networkSecret(web).ifEmpty { return null }
        return net.artisanmc.plugin.ws.HubLink(web.hubUrl, secret, networkName(web))
    }

    /**
     * Pack delegation to Nexo, Oraxen or ItemsAdder. A `.zip` path targets a file, whose
     * parent folder must be writable; any other path targets a folder. Otherwise, falls
     * back to pushing the pack to players directly.
     */
    private fun packDelegator(cfg: PluginConfig): net.artisanmc.plugin.resourcepack.ResourcePackDelegator? {
        val target = File(cfg.resourcePack.delegateToDir ?: return null)
        val checkDir = if (target.name.endsWith(".zip", ignoreCase = true)) target.parentFile ?: target else target
        if (!checkDir.exists()) checkDir.mkdirs()
        if (!checkDir.isDirectory || !checkDir.canWrite()) {
            logger.warning(
                "[delegate] delegate-to-dir ${target.absolutePath} parent " +
                    "(${checkDir.absolutePath}) is not a writable directory — falling back to pushing the pack to players directly",
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
