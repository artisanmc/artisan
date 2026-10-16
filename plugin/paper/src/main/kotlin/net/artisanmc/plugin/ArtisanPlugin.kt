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
import net.artisanmc.plugin.model.DocumentKinds
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
import java.util.UUID

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
    /** The event-registered resource-pack manager — swapped (not stacked) on `/artisan reload`. */
    @Volatile
    private var resourcePackManager: net.artisanmc.plugin.resourcepack.ResourcePackManager? = null
    lateinit var api: ArtisanAPI
        private set
    /** Editor sign-ins, kept in the suite database when it opens: they survive a restart. */
    lateinit var editorSessions: net.artisanmc.plugin.hub.Sessions
        private set
    private val editorChannel by lazy { net.artisanmc.plugin.hub.EditorChannel(logger) }
    /** Null if `web.enabled` is false or the port could not be opened. */
    @Volatile var editor: net.artisanmc.plugin.hub.HubServer? = null
        private set
    /** The editor's public address from `web.url`; empty when not set. */
    var editorUrl: String = ""
        private set
    private var editorBind: String = ""
    private var serverName: String = ""
    /** `api.menus` listeners, fired with the Bukkit menu events. */
    val menuEvents by lazy { net.artisanmc.plugin.render.MenuEventDispatcher(logger) }
    /** `api.placeholders`: survives `/artisan reload`. */
    val placeholders by lazy { PaperPlaceholders(this) }
    /** Pools lent through `api.database` (ADR `suite-foundation-database`). */
    lateinit var database: net.artisanmc.plugin.database.PooledDatabase
        private set

    companion object {
        private const val HEARTBEAT_TICKS = 20L * 60
        private const val PURGE_TICKS = 20L * 60 * 60 * 24

        fun defaultModules(): List<ArtisanModule> = listOf(
            MenusModule(),
            CommandsModule(),
        )

        fun buildApi(plugin: ArtisanPlugin): ArtisanAPI {
            val registry = ModuleRegistry()
            val nexoForCapture = net.artisanmc.plugin.engine.NexoItemRenderer.tryInit()
            plugin.projectRoots = net.artisanmc.plugin.project.ProjectRoots(File(plugin.dataFolder, "projects"), plugin.logger)
            plugin.database = net.artisanmc.plugin.database.PooledDatabase(plugin::databaseSettings, plugin.logger)
            val api = ArtisanAPI.builder(
                plugin,
                DataSourceRegistry(),
                CommandRegistry(),
                ModuleEventBus(),
                SchemaRegistry(),
                registry,
                plugin.description.version,
                // The provider is created later (it needs the API): the reload
                // resolves at call time, not at construction.
                net.artisanmc.plugin.project.ProjectContentReader(
                    plugin.projectRoots,
                    onReloadRequested = { plugin.refreshProjectsFromDisk() },
                    bundles = { if (plugin::menuProvider.isInitialized) plugin.menuProvider.allBundles() else emptyList() },
                ),
            )
                .projectRoots(plugin.projectRoots)
                // The one kind registry: the core kinds registered first, then
                // what modules add through api.documentKinds (W6).
                .documentKinds(DocumentKinds.coreRegistry().also(DocumentKinds::bind))
                .items(object : net.artisanmc.modules.api.ItemStackApi {
                    override fun serialize(stack: org.bukkit.inventory.ItemStack): String =
                        net.artisanmc.plugin.items.ItemDescriptor.serialize(stack)
                    override fun describe(stack: org.bukkit.inventory.ItemStack): Map<String, Any> =
                        net.artisanmc.plugin.items.ItemDescriptor.derive(stack, nexoForCapture)
                })
                .actions(object : net.artisanmc.modules.api.ModuleActionsApi {
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
                })
                .database(plugin.database)
                .menus(net.artisanmc.plugin.provider.PaperMenuApi(
                    provider = { if (plugin::menuProvider.isInitialized) plugin.menuProvider else null },
                    sessions = { if (plugin::sessions.isInitialized) plugin.sessions else null },
                    langOf = { if (plugin::langManager.isInitialized) plugin.langManager.playerLang(it) else "en" },
                    scheduler = plugin.scheduler,
                    events = plugin.menuEvents,
                ))
                .scheduler(net.artisanmc.plugin.scheduling.PaperSchedulerApi)
                .placeholders(plugin.placeholders)
                // Artisan's own actions are registered like a module's: every chain, core
                // included, dispatches through this registry (ADR extensible-document-kinds, R1).
                .actionRegistry(ActionRegistry().also(net.artisanmc.plugin.engine.CoreActionHandlers::registerAll))
                .build()
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
        capturedItems.reload((menuProvider as? SyncedMenuProvider)?.projectDirs() ?: projectRoots.all())
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
        api.modules.active().forEach { runCatching { it.onReload() } }
        api.events.publish(ConfigReloadEvent("menus"))
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

        // The suite database opens on the Versions thread, ahead of the first Snapshot's
        // Version (issue #42): the server row exists before it, and nothing here waits.
        versionWriter.execute { openSuiteDatabase(cfg.web) }
        // Modules register before the first `hello`, which announces them.
        startRuntime(cfg) { defaultModules().forEach { api.modules.register(it) } }
        registerCustomItemsReloadListeners()
        editorSessions = net.artisanmc.plugin.hub.Sessions(
            sessionTtl = java.time.Duration.ofDays(cfg.web.sessionDays.toLong()),
            store = editorSessionStore(),
        )
        startEditor(cfg.web)
        startEditorPermissionReports(cfg.web)

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
        versionWriter.shutdown()
        versionWriter.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)
        reloadExecutor.shutdown()
        serverRegistry?.let { registry -> runCatching { registry.stop(serverId) } }
        if (::database.isInitialized) database.closeAll()
        commandRegistrar.unregisterAll()
        menuProvider.shutdown()
        if (packetEventsLoaded) runCatching { PacketEvents.getAPI().terminate() }
        logger.info("Artisan disabled")
    }

    /** This server as seen by the editor it serves: always the current provider, which changes on each reload. */
    private val localServer = object : net.artisanmc.plugin.hub.EditorServer {
        private val provider get() = menuProvider as SyncedMenuProvider
        override val id: String get() = serverId.toString()
        override val online = true
        override val link: net.artisanmc.plugin.protocol.ServerLink get() = provider.link
        override val label: String get() = serverName.ifBlank { "Minecraft" }
        override val minecraftVersion: String get() = provider.minecraftVersion
        override val pluginVersion: String get() = description.version
        override fun modules() = api.modules.active().map { mapOf("id" to it.id, "version" to description.version) }
        override fun dataSources() = net.artisanmc.plugin.ws.DataSourceReport.build(api.dataSources)
        override fun models() = api.models.declared().map { it.document }
        override fun screens() = api.screens.declared().map { it.toWire() }
        override fun actions() = api.actionRegistry.registered().map { it.toWire() }
        override fun documentKinds() = api.documentKinds.registered().map { it.toWire() }
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

    /** This server's name in the network: `name`, else its folder name; null (logged) when `name` is invalid. */
    private fun networkName(web: net.artisanmc.plugin.hub.WebConfig): String? =
        net.artisanmc.plugin.config.serverName(web.name, File(".").absoluteFile.normalize().name) ?: null.also {
            logger.severe("[Artisan] name \"${web.name}\" in environment.yml is invalid: letters, digits, _ and - only, 64 max. Use this server's name in velocity.toml.")
        }

    val serverUuid: String get() = serverId.toString()

    /**
     * Every minute, the editor permissions of the online players, read here: the hub applies them
     * to the sessions this server issued, and signs out whoever lost `artisan.editor.view`.
     */
    private fun startEditorPermissionReports(web: net.artisanmc.plugin.hub.WebConfig) {
        if (!web.enabled || (!web.leaf && editor == null)) return
        fun report() {
            if (!isEnabled) return
            scheduler.global {
                val players = server.onlinePlayers.associate { p ->
                    p.uniqueId to net.artisanmc.plugin.hub.EditorPermissions.ALL.filter(p::hasPermission).toSet()
                }
                scheduler.async {
                    if (web.leaf) (menuProvider as? SyncedMenuProvider)?.sendModuleMessage(mapOf(
                        "type" to "editor_permissions",
                        "players" to players.entries.associate { (id, perms) -> id.toString() to perms.toList() },
                    ))
                    else editorSessions.refresh(serverUuid, players)
                }
            }
            scheduler.asyncLater(HEARTBEAT_TICKS) { report() }
        }
        scheduler.asyncLater(HEARTBEAT_TICKS) { report() }
    }

    private val serverId: UUID by lazy { net.artisanmc.plugin.database.ServerIdFile.read(File(dataFolder, "server-id")) }
    /** Artisan's own tables in the suite database, migrated once; null until [openSuiteDatabase] opened it, or when it could not. */
    @Volatile private var artisanData: javax.sql.DataSource? = null
    @Volatile private var serverRegistry: net.artisanmc.plugin.database.ServerRegistry? = null
    @Volatile private var knownCache: Pair<Long, Map<String, net.artisanmc.plugin.hub.Servers.Seen>>? = null

    /**
     * Opens the suite database (pool, migrations with their `GET_LOCK`), registers this server
     * in `artisan_servers` with its presence refreshed every minute (ADR
     * `server-identity-and-versions`), and imports the H2 history. Off the main thread, on
     * `Artisan-versions` (issue #42): the hub and the hub link read the fields set here once
     * they are, and answer "not open" until then.
     */
    private fun openSuiteDatabase(web: net.artisanmc.plugin.hub.WebConfig) {
        val data = try {
            database.dataSource(this).also { net.artisanmc.plugin.database.ArtisanSchema.migrate(it, database.dialect, logger) }
        } catch (e: Exception) {
            logger.warning("[Artisan] Suite database unavailable, offline servers and history are disabled: ${e.message}")
            if (web.leaf) logger.severe("[Artisan] Not connecting to the hub: the suite database cannot be opened.")
            return
        }
        artisanData = data
        val name = networkName(web) ?: return
        val registry = net.artisanmc.plugin.database.ServerRegistry(data, database.dialect, logger)
        val refused = when (val result = runCatching { registry.register(serverId, name, java.time.Instant.now()) }.getOrElse {
            logger.warning("[Artisan] Server registry unavailable, offline servers will not be listed: ${it.message}")
            return
        }) {
            is net.artisanmc.plugin.database.Registration.CopiedId ->
                "this server's id (plugins/Artisan/server-id) belongs to the running server \"${result.running}\": " +
                    "this folder was copied from it. Delete plugins/Artisan/server-id here and restart to make it a server of its own."
            net.artisanmc.plugin.database.Registration.NameTaken ->
                "another server already uses the name \"$name\". Set a different name in environment.yml, or restore " +
                    "plugins/Artisan/server-id if this server is that one."
            else -> null
        }
        if (refused != null) {
            logger.severe("[Artisan] Not registered in artisan_servers: $refused")
            return
        }
        serverRow = registry.rowId(serverId)
        importEmbeddedDatabase(data)
        val suite = net.artisanmc.plugin.database.SuiteProjectData(data, database.dialect, ::row, logger)
        suiteData = suite
        serverRegistry = registry
        editorChannel.onReload(suite::invalidate)
        fun beat() {
            if (!isEnabled) return
            runCatching { registry.touch(serverId, java.time.Instant.now()) }
                .onFailure { logger.warning("[Artisan] Presence not refreshed: ${it.message}") }
            scheduler.asyncLater(HEARTBEAT_TICKS) { beat() }
        }
        scheduler.asyncLater(HEARTBEAT_TICKS) { beat() }
        // Closed drafts and receipts are kept `DraftRows.KEEP`, then dropped: once a day, off the main thread.
        fun purge() {
            if (!isEnabled) return
            runCatching { suite.purge(java.time.Instant.now()) }
                .onSuccess { if (it > 0) logger.info("[Artisan] $it closed drafts and receipts purged") }
                .onFailure { logger.warning("[Artisan] Drafts not purged: ${it.message}") }
            scheduler.asyncLater(PURGE_TICKS) { purge() }
        }
        scheduler.asyncLater(HEARTBEAT_TICKS * 5) { purge() }
    }

    /** On MySQL/MariaDB, this server's history from the H2 file it ran on alone, once (ADR `server-identity-and-versions` ⑪). */
    private fun importEmbeddedDatabase(target: javax.sql.DataSource) {
        if (database.dialect == net.artisanmc.modules.api.DatabaseDialect.H2) return
        val file = File(dataFolder, "database/${net.artisanmc.plugin.database.ConnectionPools.H2_FILE}.mv.db")
        if (!file.isFile) return
        val embedded = net.artisanmc.plugin.database.ConnectionPools(
            { net.artisanmc.plugin.database.DatabaseSettings.of("h2", "", "0", "", "", "", 1, dataFolder) }, logger,
        )
        try {
            // The file may come from an older release: its tables are brought to this schema before they are read.
            val source = embedded.dataSource("Artisan-import").also { net.artisanmc.plugin.database.ArtisanSchema.migrate(it, net.artisanmc.modules.api.DatabaseDialect.H2, logger) }
            net.artisanmc.plugin.database.EmbeddedImport.run(source, target, database.dialect, serverId, logger)
        } catch (e: Exception) {
            logger.warning("[Artisan] History of the embedded database not imported: ${e.message}")
        } finally {
            embedded.closeAll()
        }
    }

    /** The other servers of `artisan_servers` by server id, with their name and last presence, cached a few seconds; null without a registry. */
    private fun knownServers(): Map<String, net.artisanmc.plugin.hub.Servers.Seen>? {
        val registry = serverRegistry ?: return null
        knownCache?.takeIf { System.currentTimeMillis() - it.first < 5_000 }?.let { return it.second }
        return runCatching { registry.others(serverId).associate { it.uuid to net.artisanmc.plugin.hub.Servers.Seen(it.name, it.lastSeen) } }.getOrNull()
            ?.also { knownCache = System.currentTimeMillis() to it }
    }

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
        serverName = networkName(web).orEmpty()
        if (!web.enabled) return
        if (web.leaf) {
            logger.info("[Artisan] Editor served by the hub at ${web.hubUrl}")
            return
        }
        try {
            val vanilla = net.artisanmc.plugin.hub.VanillaAssets(File(dataFolder, "cache/minecraft"), localServer.minecraftVersion, logger)
            val packs = net.artisanmc.plugin.hub.PackStore(File(dataFolder, "cache/resource-pack"))
            val servers = net.artisanmc.plugin.hub.Servers(localServer, ::knownServers) { id, name ->
                net.artisanmc.plugin.hub.RemoteServer(id, name, publicUrl = { editorBase() })
            }
            val prefs = net.artisanmc.plugin.hub.PlayerPrefs(File(dataFolder, "editor-prefs"))
            // The suite database may still be opening (issue #42): the routes read it once it is.
            val data = net.artisanmc.plugin.database.LateSuiteData { suiteData }
            val router = net.artisanmc.plugin.hub.EditorApi.router(servers, editorSessions, logger, vanilla, packs, prefs, data.history, data.loaded, data.drafts)
            val plugins = net.artisanmc.plugin.hub.PluginChannel(servers, networkSecret(web), editorSessions, editorChannel, ::editorBase, logger, {
                if (database.dialect == net.artisanmc.modules.api.DatabaseDialect.H2) null
                else artisanData?.let { runCatching { net.artisanmc.plugin.database.ArtisanMeta.databaseId(it) }.getOrNull() }
            }) { artisanData != null }
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
        )
        // The last applied pack survives a restart, even with the hub unreachable.
        packs.loadFromDisk()
        provider.setResourcePackManager(packs)
        registerResourcePackManager(packs)
        provider.load()

        executor = ActionExecutor(this, provider, sessions, softDeps, cooldowns, evaluator, api.commands, navigationHistory, api.actionRegistry)
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
        declaredActionsReport = { api.actionRegistry.registered().map { it.toWire() } },
        documentKindsReport = { api.documentKinds.registered().map { it.toWire() } },
        scheduler = scheduler,
        menuWindows = menuWindows,
        pluginVersion = description.version,
        nexoGlyphs = net.artisanmc.plugin.customitems.NexoGlyphReader(java.io.File(server.pluginsFolder, "Nexo")),
        serverConfig = serverConfigAccess,
        editorEvents = { editorChannel.relay(it, serverId.toString()) },
        hub = hubLink(cfg.web),
        menuEvents = menuEvents,
        onSnapshot = ::recordVersions,
        reloadExecutor = reloadExecutor,
    )

    /** Versions, loaded states and drafts in the suite database; null without a registered server. */
    @Volatile private var suiteData: net.artisanmc.plugin.database.SuiteProjectData? = null
    @Volatile private var serverRow: Int? = null
    /** One writer: Versions are recorded in the order their Snapshots were loaded, after the database opened. */
    private val versionWriter = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "Artisan-versions").apply { isDaemon = true } }
    /** Reloads asked after the start (`api.project.reload()`, a root registered): disk reads and YAML off the game threads. */
    private val reloadExecutor = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "Artisan-reload").apply { isDaemon = true } }

    /**
     * Each Project whose loaded Snapshot differs from its latest Version gets a new one, then the
     * loaded state. A Version that failed keeps the state where it was: the hub would otherwise
     * serve the new hash over the previous Version's files, and `if_hash` would call that unchanged.
     */
    private fun recordVersions(
        snapshot: net.artisanmc.plugin.project.ProjectSnapshot,
        authors: Map<String, net.artisanmc.plugin.protocol.PublicationAuthor>,
        done: () -> Unit,
    ) {
        val now = java.time.Instant.now()
        versionWriter.execute {
            // Read here, not before: the first Snapshot is queued while the database is still opening.
            val data = suiteData ?: return@execute done()
            val server = serverRow ?: return@execute done()
            var failed = 0
            for (id in snapshot.projectIds) runCatching {
                val dir = projectRoots.dirFor(id)
                val content = { path: String -> !net.artisanmc.plugin.sync.BundleHasher.isArtisanMeta(path) }
                val entries = snapshot.files[id].orEmpty().filterKeys(content).mapValues { net.artisanmc.plugin.database.SnapshotEntry.text(it.value) } +
                    snapshot.binaries[id].orEmpty().filterKeys(content).mapValues { net.artisanmc.plugin.database.SnapshotEntry.binary(it.value.hash, it.value.size) }
                val published = authors[id]
                val author = published?.let { net.artisanmc.plugin.database.VersionAuthor(it.id, it.name) }
                val result = data.versions.record(server, projectRoots.key(id), id, entries, now, author, published?.restoredFrom?.toIntOrNull()) { File(dir, it).readBytes() }
                if (result.skipped.isNotEmpty())
                    logger.warning("[Artisan] Project $id: ${result.skipped.joinToString()} changed on disk since the reload, kept out of this Version")
            }.onFailure { failed++; logger.warning("[Artisan] Version of project $id not recorded: ${it.message}") }
            if (failed == 0) runCatching { data.recordState(server, loadedState(snapshot), now) }
                .onFailure { logger.warning("[Artisan] Loaded state not recorded: ${it.message}") }
            else logger.warning("[Artisan] Loaded state not recorded: $failed Version(s) failed, the editor keeps the previous one")
            done()
        }
    }

    /** The Project list and, per Project, the Snapshot hash, failed files and editor metadata: what the hub serves. */
    private fun loadedState(snapshot: net.artisanmc.plugin.project.ProjectSnapshot): Map<String, Any?> {
        val projects = snapshot.projectIds.associateWith { id ->
            mapOf(
                "hash" to snapshot.hash(id),
                "failed" to snapshot.skipped[id].orEmpty().toSortedMap().map { (path, reason) -> mapOf("path" to path, "reason" to reason) },
                // `.artisan/editor.yaml`: read by the editor, outside the Versions.
                "meta" to snapshot.files[id].orEmpty().filterKeys { net.artisanmc.plugin.sync.BundleHasher.isArtisanMeta(it) },
            )
        }
        return net.artisanmc.plugin.protocol.ProjectReads.listBody(snapshot, projectRoots) + ("projects" to projects)
    }

    /** The `artisan_servers` row of a server id: this server's, read once, else looked up. */
    private fun row(server: String): Int? {
        if (server == serverId.toString()) return serverRow
        val id = runCatching { UUID.fromString(server) }.getOrNull() ?: return null
        return serverRegistry?.rowId(id)
    }

    /**
     * `artisan_editor_sessions` once the suite database is open; before that, and when it fails,
     * the sessions in memory alone: signed-in players stay signed in until a restart.
     */
    private fun editorSessionStore() = object : net.artisanmc.plugin.hub.SessionStore {
        private fun <T> safe(block: (net.artisanmc.plugin.database.EditorSessionRows) -> T): T? {
            val rows = net.artisanmc.plugin.database.EditorSessionRows(artisanData ?: return null)
            return runCatching { block(rows) }.onFailure { logger.warning("[Artisan] Editor sessions not stored: ${it.message}") }.getOrNull()
        }

        override fun put(key: String, session: net.artisanmc.plugin.hub.EditorSession) {
            safe { it.put(key, net.artisanmc.plugin.database.EditorSessionRow(session.playerId, session.playerName, session.permissions, session.expiresAt, session.origin)) }
        }
        override fun get(key: String) = safe { it.get(key) }?.let {
            net.artisanmc.plugin.hub.EditorSession("", it.playerId, it.playerName, it.permissions, it.expiresAt, it.origin)
        }
        override fun touch(key: String, expiresAt: java.time.Instant) { safe { it.touch(key, expiresAt) } }
        override fun delete(key: String) { safe { it.delete(key) } }
        override fun purge(now: java.time.Instant) { safe { it.purge(now) } }
        override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) { safe { it.setPermissions(playerId, origin, permissions) } }
        override fun deletePlayer(playerId: UUID, origin: String?) = safe { it.deletePlayer(playerId, origin) } ?: 0
    }

    /** Only a leaf opens a WebSocket: to `web.hub`, with the network secret. */
    private fun hubLink(web: net.artisanmc.plugin.hub.WebConfig): net.artisanmc.plugin.ws.HubLink? {
        if (!web.leaf) return null
        val secret = networkSecret(web).ifEmpty { return null }
        val name = networkName(web) ?: return null
        if (database.dialect == net.artisanmc.modules.api.DatabaseDialect.H2) {
            logger.severe("[Artisan] Not connecting to the hub: a network needs a shared MySQL or MariaDB database, this server uses H2 (database.type in environment.yml).")
            return null
        }
        // Read when the socket opens: null while the database is still opening, and the client waits for it.
        val databaseId = { artisanData?.let { runCatching { net.artisanmc.plugin.database.ArtisanMeta.databaseId(it) }.getOrNull() } }
        return net.artisanmc.plugin.ws.HubLink(web.hubUrl, secret, name, databaseId, serverId.toString())
    }

    /**
     * Pack delegation to Nexo, Oraxen or ItemsAdder. A `.zip` path targets a file, whose
     * parent folder must be writable; any other path targets a folder. Otherwise null: the
     * pack reaches no player, and each update says so in the console.
     */
    private fun packDelegator(cfg: PluginConfig): net.artisanmc.plugin.resourcepack.ResourcePackDelegator? {
        val target = File(cfg.resourcePack.delegateToDir ?: return null)
        val checkDir = if (target.name.endsWith(".zip", ignoreCase = true)) target.parentFile ?: target else target
        if (!checkDir.exists()) checkDir.mkdirs()
        if (!checkDir.isDirectory || !checkDir.canWrite()) {
            logger.warning(
                "[delegate] delegate-to-dir ${target.absolutePath} parent " +
                    "(${checkDir.absolutePath}) is not a writable directory — Artisan's pack will not reach players",
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
     * manager from the freshly read config. Without this swap the stale instance keeps logging
     * every pack status a second time.
     */
    private fun registerResourcePackManager(manager: net.artisanmc.plugin.resourcepack.ResourcePackManager) {
        resourcePackManager?.let { org.bukkit.event.HandlerList.unregisterAll(it) }
        server.pluginManager.registerEvents(manager, this)
        resourcePackManager = manager
    }
}
