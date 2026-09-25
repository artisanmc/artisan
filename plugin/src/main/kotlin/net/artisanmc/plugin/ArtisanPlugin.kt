package net.artisanmc.plugin

import net.artisanmc.plugin.assistant.ImportSourceReader
import net.artisanmc.modules.api.*
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
import net.artisanmc.plugin.render.MenuListener
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

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
    private val playerSlots = net.artisanmc.plugin.render.PlayerSlotOverlayStore()
    private var playerSlotsHooked = false
    private lateinit var cooldowns: CooldownStore
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

    companion object {
        fun defaultModules(): List<ArtisanModule> = listOf(
            MenusModule(),
            CommandsModule(),
        )

        fun buildApi(plugin: ArtisanPlugin): ArtisanAPI {
            val registry = ModuleRegistry()
            val nexoForCapture = net.artisanmc.plugin.engine.NexoItemRenderer.tryInit()
            plugin.projectRoots = net.artisanmc.plugin.project.ProjectRoots(File(plugin.dataFolder, "projects"), plugin.logger)
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
                                ),
                            )
                        }
                        if (org.bukkit.Bukkit.isPrimaryThread()) run.run()
                        else org.bukkit.Bukkit.getScheduler().runTask(plugin, run)
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

    override fun onEnable() {
        saveDefaultConfig()
        api = buildApi(this)
        server.servicesManager.register(ArtisanAPI::class.java, api, this, org.bukkit.plugin.ServicePriority.Normal)
        val cfg = PluginConfig.from(config)
        cfg.assistantImportSourceWarnings.forEach { logger.warning("[assistant] $it") }
        projectRoots.coreRoot.mkdirs()

        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)

        capturedItems = net.artisanmc.plugin.items.CapturedItemStore(projectRoots, logger)
        capturedItems.reload()
        val softDeps = SoftDepRegistry(this, capturedItems)
        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        playerSlotsHooked = hookPlayerSlots()
        playerSlots.active = cfg.playerInventorySlots && playerSlotsHooked
        if (cfg.playerInventorySlots && !playerSlotsHooked) {
            logger.warning("menus.player-inventory-slots needs the PacketEvents plugin — player inventory slots stay vanilla")
        }
        val evaluator = ConditionEvaluator(softDeps, cooldowns)
        // Disk-cached asset index: glyph/font titles keep rendering with the
        // backend down or gone (offline completeness — the catalog was
        // previously HTTP-only and booted empty offline).
        assetCatalog = net.artisanmc.plugin.resourcepack.AssetCatalog(
            cacheFile = java.io.File(dataFolder, "cache/asset-index.json"),
        )
        assetCatalog.loadFromDisk()

        commandRegistrar = CommandRegistrar(this, langManager)
        menuProvider = SyncedMenuProvider(
            roots            = projectRoots,
            serverKey        = cfg.serverKey,
            editorAccessMode = cfg.editorAccessMode,
            wsUrl            = cfg.wsUrl,
            logger           = logger,
            evaluator        = evaluator,
            sessions         = sessions,
            onReload         = {
                capturedItems.reload()
                commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
                api.modules.active().forEach { runCatching { it.onReload() } }
                api.events.publish(ConfigReloadEvent(moduleId = "menus"))
            },
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
            runOnMainThread = { task -> server.scheduler.runTask(this@ArtisanPlugin, Runnable { task() }) },
            playerSlots = playerSlots,
        )
        moduleMessageSender = { m -> (menuProvider as? SyncedMenuProvider)?.sendModuleMessage(m) }
        defaultModules().forEach { api.modules.register(it) }
        // Inject before load() so the initial hello includes the correct custom_items_hash.
        // Nexo/Oraxen fire their "items loaded" events before Artisan enables (softdepend order),
        // so registering hot-reload listeners alone is not sufficient for the first startup.
        val pluginsDir = server.pluginsFolder
        val customItemsManager = net.artisanmc.plugin.customitems.CustomItemsManager(
            listOf(
                net.artisanmc.plugin.customitems.NexoSource(pluginsDir),
                net.artisanmc.plugin.customitems.OraxenSource(pluginsDir),
                net.artisanmc.plugin.customitems.ItemsAdderSource(pluginsDir),
            )
        )
        val syncedProvider = menuProvider as? SyncedMenuProvider
        syncedProvider?.setCustomItemsManager(customItemsManager)
        val delegator: net.artisanmc.plugin.resourcepack.ResourcePackDelegator? =
            cfg.resourcePack.delegateToDir?.let { path ->
                val target = File(path)
                // `.zip` paths target a single file; everything else targets a directory.
                // Validate the right thing in each mode — for zip mode the *parent*
                // directory must be writable (we write/atomic-replace the zip there),
                // not the zip itself.
                val isZipTarget = target.name.endsWith(".zip", ignoreCase = true)
                val checkDir = if (isZipTarget) target.parentFile ?: target else target
                if (!checkDir.exists()) checkDir.mkdirs()
                if (!checkDir.isDirectory || !checkDir.canWrite()) {
                    logger.warning(
                        "[delegate] delegate-to-dir ${target.absolutePath} parent " +
                        "(${checkDir.absolutePath}) is not a writable directory — " +
                        "falling back to legacy push mode"
                    )
                    null
                } else {
                    val dir = target
                    logger.info("[delegate] delegation enabled, target dir: ${dir.absolutePath}")
                    net.artisanmc.plugin.resourcepack.ResourcePackDelegator(dir, logger)
                }
            }
        val resourcePackManager = net.artisanmc.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
            delegator = delegator,
            cacheFile = java.io.File(dataFolder, "cache/resource-pack.json"),
        )
        // Restore the last applied project info so push mode survives a restart
        // during a backend outage (a later hello_ack simply refreshes).
        resourcePackManager.loadFromDisk()
        syncedProvider?.setResourcePackManager(resourcePackManager)
        registerResourcePackManager(resourcePackManager)
        menuProvider.load()
        if (syncedProvider != null) registerCustomItemsReloadListeners(syncedProvider)

        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator, api.commands)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)

        artisanCommand = ArtisanCommand(this, langManager)
        getCommand("artisan")?.setExecutor(artisanCommand)
        getCommand("artisan")?.tabCompleter = artisanCommand
        server.pluginManager.registerEvents(MenuListener(this, sessions, executor, playerSlots), this)
        logger.info("Artisan ${description.version} enabled")
    }

    override fun onDisable() {
        api.modules.active().forEach { runCatching { it.onDisable() } }
        artisanCommand.shutdown()
        commandRegistrar.unregisterAll()
        menuProvider.shutdown()
        logger.info("Artisan disabled")
    }

    private fun registerCustomItemsReloadListeners(provider: SyncedMenuProvider) {
        val mgr = server.pluginManager

        // Initial custom items hash sync, post-server-load.
        // Runs regardless of which custom-items plugin is installed.
        // Short delay (40 ticks ≈ 2 s) lets Nexo/Oraxen/ItemsAdder finish populating
        // their item registries and the WS hello to settle before we push the hash.
        // notifyCustomItemsReload itself runs on a Bukkit async worker.
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: org.bukkit.event.server.ServerLoadEvent) {
                server.scheduler.runTaskLaterAsynchronously(this@ArtisanPlugin, Runnable {
                    provider.notifyCustomItemsReload()
                    // Un module qui écrit dans son project à l'activation n'a plus
                    // rien à rattraper : le disque est la seule vérité, donc son
                    // fichier est déjà en place (ADR `server-disk-only-storage`).
                    // Avant, il fallait rejouer le contrôle de synchro du hello_ack,
                    // sinon le sweep du bundle suivant effaçait le fichier.
                }, 40L)
            }
        }, this)

        if (mgr.getPlugin("Nexo") != null) {
            // Hot-reload listener: fires on /nexo reload during runtime
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: com.nexomc.nexo.api.events.NexoItemsLoadedEvent) {
                    server.scheduler.runTaskAsynchronously(this@ArtisanPlugin, Runnable {
                        provider.notifyCustomItemsReload()
                    })
                }
            }, this)
        }

        if (mgr.getPlugin("Oraxen") != null) {
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: io.th0rgal.oraxen.api.events.OraxenItemsLoadedEvent) {
                    server.scheduler.runTaskAsynchronously(this@ArtisanPlugin, Runnable {
                        provider.notifyCustomItemsReload()
                    })
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
                            server.scheduler.runTaskAsynchronously(this@ArtisanPlugin, Runnable {
                                provider.notifyCustomItemsReload()
                            })
                        }
                    },
                    this,
                )
            } catch (_: Exception) {
                logger.warning("ItemsAdder found but could not register hot-reload listener")
            }
        }
    }

    /**
     * Branche la réécriture des slots joueur sur PacketEvents, s'il est là.
     * Seul point qui charge [net.artisanmc.plugin.render.PacketEventsPlayerSlots] :
     * sans le plugin, ses imports ne sont jamais résolus.
     */
    private fun hookPlayerSlots(): Boolean {
        if (server.pluginManager.getPlugin("packetevents") == null) return false
        return runCatching { net.artisanmc.plugin.render.PacketEventsPlayerSlots(playerSlots).register() }
            .onFailure { logger.warning("PacketEvents found but player slot overlay failed to register: ${it.message}") }
            .isSuccess
    }

    /** Test-only seam: swap in a fake [MenuProvider] after onEnable has run. */
    internal fun setMenuProviderForTesting(provider: MenuProvider) {
        menuProvider = provider
    }

    fun reinit(cfg: PluginConfig) {
        cfg.assistantImportSourceWarnings.forEach { logger.warning("[assistant] $it") }
        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)
        playerSlots.active = cfg.playerInventorySlots && playerSlotsHooked
        menuProvider.unload()
        projectRoots.coreRoot.mkdirs()

        capturedItems = net.artisanmc.plugin.items.CapturedItemStore(projectRoots, logger)
        capturedItems.reload()
        val softDeps = SoftDepRegistry(this, capturedItems)
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            roots            = projectRoots,
            serverKey        = cfg.serverKey,
            editorAccessMode = cfg.editorAccessMode,
            wsUrl            = cfg.wsUrl,
            logger           = logger,
            evaluator        = evaluator,
            sessions         = sessions,
            onReload         = {
                capturedItems.reload()
                commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
                api.modules.active().forEach { runCatching { it.onReload() } }
                api.events.publish(ConfigReloadEvent(moduleId = "menus"))
            },
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
            runOnMainThread = { task -> server.scheduler.runTask(this@ArtisanPlugin, Runnable { task() }) },
            playerSlots = playerSlots,
        )
        moduleMessageSender = { m -> (menuProvider as? SyncedMenuProvider)?.sendModuleMessage(m) }
        val pluginsDirReinit = server.pluginsFolder
        val customItemsManagerReinit = net.artisanmc.plugin.customitems.CustomItemsManager(
            listOf(
                net.artisanmc.plugin.customitems.NexoSource(pluginsDirReinit),
                net.artisanmc.plugin.customitems.OraxenSource(pluginsDirReinit),
                net.artisanmc.plugin.customitems.ItemsAdderSource(pluginsDirReinit),
            )
        )
        val syncedProviderReinit = menuProvider as? SyncedMenuProvider
        syncedProviderReinit?.setCustomItemsManager(customItemsManagerReinit)
        val delegatorReinit: net.artisanmc.plugin.resourcepack.ResourcePackDelegator? =
            cfg.resourcePack.delegateToDir?.let { path ->
                val target = File(path)
                // `.zip` paths target a single file; everything else targets a directory.
                // Validate the right thing in each mode — for zip mode the *parent*
                // directory must be writable (we write/atomic-replace the zip there),
                // not the zip itself.
                val isZipTarget = target.name.endsWith(".zip", ignoreCase = true)
                val checkDir = if (isZipTarget) target.parentFile ?: target else target
                if (!checkDir.exists()) checkDir.mkdirs()
                if (!checkDir.isDirectory || !checkDir.canWrite()) {
                    logger.warning(
                        "[delegate] delegate-to-dir ${target.absolutePath} parent " +
                        "(${checkDir.absolutePath}) is not a writable directory — " +
                        "falling back to legacy push mode"
                    )
                    null
                } else {
                    val dir = target
                    logger.info("[delegate] delegation enabled, target dir: ${dir.absolutePath}")
                    net.artisanmc.plugin.resourcepack.ResourcePackDelegator(dir, logger)
                }
            }
        val resourcePackManagerReinit = net.artisanmc.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
            delegator = delegatorReinit,
            cacheFile = java.io.File(dataFolder, "cache/resource-pack.json"),
        )
        resourcePackManagerReinit.loadFromDisk()
        syncedProviderReinit?.setResourcePackManager(resourcePackManagerReinit)
        registerResourcePackManager(resourcePackManagerReinit)
        menuProvider.load()
        if (syncedProviderReinit != null) registerCustomItemsReloadListeners(syncedProviderReinit)
        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator, api.commands)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)

        // reinit happens after ServerLoadEvent has already fired, so we kick off
        // the initial custom items hash sync here ourselves. Short delay lets the
        // fresh WsClient finish handshaking before notify pushes the hash.
        val reinitProvider = menuProvider as? SyncedMenuProvider
        if (reinitProvider != null) {
            server.scheduler.runTaskLaterAsynchronously(this, Runnable {
                reinitProvider.notifyCustomItemsReload()
            }, 40L)
        }
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
