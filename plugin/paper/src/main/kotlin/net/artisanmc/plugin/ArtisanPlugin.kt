package net.artisanmc.plugin

import net.artisanmc.modules.api.*
import net.artisanmc.modules.api.action.ActionRegistry
import net.artisanmc.modules.api.action.ModuleActionsApi
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.event.ConfigReloadEvent
import net.artisanmc.modules.api.event.ModuleEventBus
import net.artisanmc.modules.api.item.ItemStackApi
import net.artisanmc.plugin.scheduling.Scheduler
import net.artisanmc.plugin.scheduling.schedulerFor
import net.artisanmc.modules.commands.CommandsModule
import net.artisanmc.modules.menus.MenusModule
import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.engine.MenuProvider
import net.artisanmc.plugin.provider.SyncedMenuProvider
import com.github.retrooper.packetevents.PacketEvents
import io.github.retrooper.packetevents.factory.spigot.SpigotPacketEventsBuilder
import net.artisanmc.plugin.render.packets.ClientSlotSink
import net.artisanmc.plugin.listener.MenuListener
import net.artisanmc.plugin.render.packets.MenuWindows
import net.artisanmc.plugin.render.packets.PacketEventsMenuPackets
import net.artisanmc.plugin.render.packets.PacketEventsSlotSink
import org.bukkit.plugin.java.JavaPlugin
import java.io.File
import net.artisanmc.plugin.integrations.PaperPlaceholders

open class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        internal set
    val scheduler: Scheduler by lazy { schedulerFor(this) }

    /**
     * Snapshot reload requested by an Add-on (`api.project.reload()`).
     *
     * A no-op before the provider exists: a module writing during its own `onEnable`
     * has nothing to reload, the following load reads its disk anyway.
     */
    fun refreshProjectsFromDisk() {
        if (!::menuProvider.isInitialized) return
        (menuProvider as? SyncedMenuProvider)?.refreshFromDisk()
    }
    private lateinit var artisanCommand: ArtisanCommand
    internal lateinit var menuWindows: MenuWindows
        private set
    /** Survives `/artisan reload`: the pack manager is swapped, the players' loaded packs are not. */
    private val packLoads = net.artisanmc.plugin.resourcepack.PackLoadTracker()
    private val openedContainers = net.artisanmc.plugin.render.title.OpenedContainers()
    private var packetEventsLoaded = false
    /** Exposed for /artisan dump-title diagnostics. */
    lateinit var assetCatalog: net.artisanmc.plugin.resourcepack.AssetCatalog
        internal set
    lateinit var langManager: LangManager
    lateinit var capturedItems: net.artisanmc.plugin.items.CapturedItemStore
    /** projectId -> working-copy root, unioning the core projects dir with Add-on-owned roots. */
    lateinit var projectRoots: net.artisanmc.plugin.project.ProjectRoots
        internal set
    lateinit var api: ArtisanAPI
        private set
    /** Editor sign-ins, kept in the suite database when it opens: they survive a restart. */
    lateinit var editorSessions: net.artisanmc.plugin.hub.Sessions
        private set
    /** `api.menus` listeners, fired with the Bukkit menu events. */
    val menuEvents by lazy { net.artisanmc.plugin.listener.MenuEventDispatcher(logger) }
    /** `api.placeholders`: survives `/artisan reload`. */
    val placeholders by lazy { PaperPlaceholders(this) }
    /** Geyser, when installed: the Bedrock pack per session and who plays from Bedrock. */
    val geyser by lazy { net.artisanmc.plugin.integrations.GeyserIntegration(this) }
    /** Pools lent through `api.database` (ADR `suite-foundation-database`). */
    lateinit var database: net.artisanmc.plugin.database.PooledDatabase
        internal set

    /** The suite database: server id and row, Versions, editor sessions. */
    internal val suite = SuiteDatabase(this)
    /** The editor web server (hub) or the link to the hub (leaf). */
    internal val editorHost = EditorHost(this, suite)
    /** What `/artisan reload` rebuilds: provider, engine, resource pack, commands. */
    internal val runtime = RuntimeAssembly(this, suite, editorHost)

    /** Null if `web.enabled` is false or the port could not be opened. */
    val editor: net.artisanmc.plugin.hub.HubServer? get() = editorHost.editor
    /** The editor's public address from `web.url`; empty when not set. */
    val editorUrl: String get() = editorHost.editorUrl

    internal val menuProviderOrNull: MenuProvider? get() = if (::menuProvider.isInitialized) menuProvider else null
    internal val langManagerOrNull: LangManager? get() = if (::langManager.isInitialized) langManager else null

    companion object {
        fun defaultModules(): List<ArtisanModule> = listOf(
            MenusModule(),
            CommandsModule(),
        )

        fun buildApi(plugin: ArtisanPlugin): ArtisanAPI = ArtisanApiFactory.build(plugin)
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
            val chestTexture = net.artisanmc.plugin.render.title.VanillaGuiTitle.Rule(
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
        geyser.start()
        saveDefaultConfig()
        api = buildApi(this)
        server.servicesManager.register(ArtisanAPI::class.java, api, this, org.bukkit.plugin.ServicePriority.Normal)
        registerAddonRelease()
        server.pluginManager.registerEvents(database, this)
        val cfg = loadPluginConfig()
        projectRoots.coreRoot.mkdirs()

        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)

        runtime.prepare(langManager)

        // The suite database opens on the Versions thread, ahead of the first Snapshot's
        // Version (issue #42): the server row exists before it, and nothing here waits.
        suite.open(cfg.web, editorHost.editorChannel)
        // Modules register before the first `hello`, which announces them.
        runtime.start(cfg) { defaultModules().forEach { api.modules.register(it) } }
        runtime.registerCustomItemsReloadListeners()
        editorSessions = net.artisanmc.plugin.hub.Sessions(
            sessionTtl = java.time.Duration.ofDays(cfg.web.sessionDays.toLong()),
            store = suite.editorSessionStore(),
        )
        editorHost.start(cfg.web)
        editorHost.startPermissionReports(cfg.web)

        artisanCommand = ArtisanCommand(this, langManager)
        getCommand("artisan")?.setExecutor(artisanCommand)
        getCommand("artisan")?.tabCompleter = artisanCommand
        server.pluginManager.registerEvents(MenuListener(this, runtime.sessions, runtime.executor, menuWindows, history = runtime.navigationHistory, events = menuEvents), this)
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
        suite.stopWriter()
        runtime.stopReloads()
        suite.unregister()
        if (::database.isInitialized) database.closeAll()
        runtime.commandRegistrar.unregisterAll()
        menuProvider.shutdown()
        if (packetEventsLoaded) runCatching { PacketEvents.getAPI().terminate() }
        logger.info("Artisan disabled")
    }

    /** This server's name in the network: `name`, else its folder name; null (logged) when `name` is invalid. */
    internal fun networkName(web: net.artisanmc.plugin.hub.WebConfig): String? =
        net.artisanmc.plugin.config.serverName(web.name, File(".").absoluteFile.normalize().name) ?: null.also {
            logger.severe("[Artisan] name \"${web.name}\" in environment.yml is invalid: letters, digits, _ and - only, 64 max. Use this server's name in velocity.toml.")
        }

    val serverUuid: String get() = suite.serverId.toString()

    internal fun stopEditor() = editorHost.stop()

    /** What this server announces at Presence: to the editor it serves, and in its `hello` to a hub. */
    internal fun announcement() = net.artisanmc.plugin.protocol.ServerAnnouncement(
        modules = api.modules.active().map { net.artisanmc.plugin.protocol.ServerAnnouncement.module(it.id, description.version) },
        dataSources = net.artisanmc.plugin.ws.DataSourceReport.build(api.dataSources),
        models = api.models.declared().map { it.document },
        screens = api.screens.declared().map { it.toWire() },
        actions = api.actionRegistry.registered().map { it.toWire() },
        documentKinds = api.documentKinds.registered().map { it.toWire() },
    )

    val environmentFile: File get() = File(dataFolder, "environment.yml")

    /** Called on the main thread; reloads on the next tick, once the reply is sent. */
    internal val serverConfigAccess = object : net.artisanmc.plugin.config.ServerConfigAccess {
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

    fun reinit(cfg: PluginConfig) = runtime.reinit(cfg)
}
