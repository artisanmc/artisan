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
    /** `api.translations`: survives `/artisan reload`, which [Translations.configure]s it again. */
    val translations by lazy { net.artisanmc.plugin.lang.Translations(logger = logger) }
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
    /** Pools lent through `api.database` (ADR `suite-foundation-database`). */
    lateinit var database: net.artisanmc.plugin.database.PooledDatabase
        internal set

    /** The suite database: server id and row, Versions, editor sessions. */
    internal val suite = SuiteDatabase(this)
    /** The editor web server (hub) or the link to the hub (leaf). */
    internal val editorHost = EditorHost(this, suite)
    /** What `/artisan reload` rebuilds: provider, engine, resource pack, commands. */
    internal val runtime = RuntimeAssembly(this, suite, editorHost)

    /** Development: modules' editor views read from files (`dev.editor-bundles` in environment.yml). */
    internal val localEditorBundles by lazy { LocalEditorBundles(api.editorBundles, logger) }

    /** Null if `web.enabled` is false or the port could not be opened. */
    val editor: net.artisanmc.plugin.hub.HubServer? get() = editorHost.editor
    /** The editor's public address from `web.url`; empty when not set. */
    val editorUrl: String get() = editorHost.editorUrl

    internal val menuProviderOrNull: MenuProvider? get() = if (::menuProvider.isInitialized) menuProvider else null
    internal val langManagerOrNull: LangManager? get() = if (::langManager.isInitialized) langManager else null
    internal val capturedItemsOrNull: net.artisanmc.plugin.items.CapturedItemStore? get() = if (::capturedItems.isInitialized) capturedItems else null

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
        saveDefaultConfig()
        api = buildApi(this)
        server.servicesManager.register(ArtisanAPI::class.java, api, this, org.bukkit.plugin.ServicePriority.Normal)
        registerAddonRelease()
        server.pluginManager.registerEvents(database, this)
        val cfg = loadPluginConfig()
        projectRoots.coreRoot.mkdirs()
        localEditorBundles.configure(cfg.devEditorBundles)

        translations.configure(cfg.language, cfg.perPlayerLanguage)
        langManager = LangManager(translations.register(LangManager.NAMESPACE, null, null) {
            net.artisanmc.plugin.lang.FileMessageSource.load(this, LangManager.BUNDLED_LANGS)
        })

        runtime.prepare(langManager)

        // The suite database opens on the Versions thread, ahead of the first Snapshot's
        // Version (issue #42): the server row exists before it, and nothing here waits.
        suite.open(cfg.web, editorHost.editorChannel)
        // Modules register before the first `hello`, which announces them.
        runtime.start(cfg) { defaultModules().forEach { api.modules.register(it) } }
        runtime.registerCustomItemsReloadListeners()

        // The game side is complete here: the API is served, the engine runs, menus open
        // and `/artisan` answers. What follows is the editor, which the suite's plugins
        // (quests, guilds, lands...) do not need: a failure there is logged and the
        // plugin stays enabled with everything above, instead of taking them down with it.
        artisanCommand = ArtisanCommand(this, langManager)
        getCommand("artisan")?.setExecutor(artisanCommand)
        getCommand("artisan")?.tabCompleter = artisanCommand
        server.pluginManager.registerEvents(MenuListener(this, runtime.sessions, runtime.executor, menuWindows, history = runtime.navigationHistory, events = menuEvents), this)
        if (!net.artisanmc.plugin.platform.ServerPlatform.paper) {
            runCatching { net.artisanmc.plugin.render.dialog.SpigotDialogRenderer.register(this) }
                .onFailure { logger.warning("[Artisan] dialogs unavailable on this server: ${it.message}") }
        }

        // The sign-in store cannot fail and `/artisan editor` reads it: outside the guard.
        editorSessions = net.artisanmc.plugin.hub.Sessions(
            sessionTtl = java.time.Duration.ofDays(cfg.web.sessionDays.toLong()),
            store = suite.editorSessionStore(),
            writer = suite.sessionWriter(),
        )
        try {
            startEditor(cfg)
        } catch (t: Throwable) {
            if (t is VirtualMachineError) throw t
            logger.log(
                java.util.logging.Level.SEVERE,
                "[Artisan] The editor could not start: menus, commands and the modules keep running without it. Fix the cause and restart.",
                t,
            )
        }
        logger.info("Artisan ${description.version} enabled")
    }

    /** The editor side: the hub (or the link to it), the dev bundles, the permission reports. */
    internal open fun startEditor(cfg: PluginConfig) {
        editorHost.start(cfg.web)
        // A leaf tells the hub; the editor of a hub reads the announcement on its next load.
        localEditorBundles.watch(scheduler) { (menuProviderOrNull as? SyncedMenuProvider)?.notifyModulesChanged() }
        editorHost.startPermissionReports(cfg.web)
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
                translations.unregisterOwnedBy(event.plugin)
                releaseListeners(event.plugin)
            }
        }, this)
    }

    /**
     * What a disabling plugin subscribed outside its modules: left behind, after a `/plugman reload`
     * its old listeners would run the code of a closed jar. The event fires before the plugin's
     * onDisable, so this also removes what that onDisable would cancel itself: logged at FINE.
     */
    private fun releaseListeners(plugin: org.bukkit.plugin.Plugin) {
        val loader = plugin.javaClass.classLoader
        val left = buildList {
            placeholders.unregisterLoadedBy(loader).forEach { add("placeholders %${it}_…%") }
            menuEvents.releaseLoadedBy(loader).takeIf { it > 0 }?.let { add("$it api.menus listener(s)") }
            api.events.unsubscribeLoadedBy(loader).takeIf { it > 0 }?.let { add("$it api.events handler(s)") }
        }
        if (left.isNotEmpty()) logger.fine("[Artisan] ${plugin.name} disabled: removed ${left.joinToString()}")
    }

    override fun onDisable() {
        localEditorBundles.stop()
        stopEditor()
        // Modules of add-ons already went with their plugin (registerAddonRelease).
        api.modules.active().forEach { runCatching { it.onDisable() } }
        suite.stopWriter()
        runtime.stopReloads()
        suite.unregister()
        if (::database.isInitialized) database.closeAll()
        runtime.commandRegistrar.unregisterAll()
        menuProviderOrNull?.shutdown()
        if (!net.artisanmc.plugin.platform.ServerPlatform.paper) runCatching { net.artisanmc.plugin.render.dialog.SpigotDialogRenderer.unregister() }
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

    /** The last announcement built; null once a module, a command or an editor bundle changed. */
    @Volatile private var announced: net.artisanmc.plugin.protocol.ServerAnnouncement? = null

    /**
     * What this server announces at Presence: to the editor it serves, and in its `hello` to a hub.
     * Built once per change: the hub's routes read it at each GET (seven of them per editor load),
     * and `notifyModulesChanged` is the one signal that the registries behind it moved.
     */
    internal fun announcement(): net.artisanmc.plugin.protocol.ServerAnnouncement =
        announced ?: buildAnnouncement().also { announced = it }

    /** The next [announcement] is built again: called with the modules' and commands' change signal. */
    internal fun announcementChanged() { announced = null }

    private fun buildAnnouncement() = net.artisanmc.plugin.protocol.ServerAnnouncement(
        modules = api.modules.active().map {
            net.artisanmc.plugin.protocol.ServerAnnouncement.module(
                it.id, description.version, localEditorBundles.wire(it.id), api.templates.of(it.id).map { t -> t.toWire() },
            )
        },
        dataSources = net.artisanmc.plugin.ws.DataSourceReport.build(api.dataSources),
        models = api.models.declared().map { it.document },
        screens = api.screens.declared().map { it.toWire() },
        actions = api.actionRegistry.registered().map { it.toWire() },
        documentKinds = api.documentKinds.registered().map { it.toWire() },
        playerCommands = net.artisanmc.plugin.ws.PlayerCommandReport.build(api.playerCommands),
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
        return readPluginConfig().also { loadedConfig = it }
    }

    /** What [loadPluginConfig] last read: the configuration the plugin runs with. */
    @Volatile private var loadedConfig: PluginConfig? = null

    fun databaseSettings(): net.artisanmc.plugin.database.DatabaseSettings =
        net.artisanmc.plugin.database.readDatabaseSettings(
            org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(environmentFile), config, dataFolder,
        ) { logger.warning("[database] environment variable $it is not set (environment.yml)") }

    /**
     * The configuration as loaded at start or by the last `/artisan reload` or settings write: a
     * command reads it without parsing `environment.yml` again.
     */
    fun currentConfig(): PluginConfig = loadedConfig ?: readPluginConfig()

    private fun readPluginConfig(): PluginConfig =
        PluginConfig.from(config, org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(environmentFile))

    fun reinit(cfg: PluginConfig) = runtime.reinit(cfg)
}
