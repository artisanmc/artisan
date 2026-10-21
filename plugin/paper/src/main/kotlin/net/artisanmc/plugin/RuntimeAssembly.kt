package net.artisanmc.plugin

import net.artisanmc.modules.api.event.ConfigReloadEvent
import net.artisanmc.plugin.command.CommandRegistrar
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.customitems.CustomItemPlugins
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.session.NavigationHistoryStore

/**
 * What `/artisan reload` rebuilds from the config ([start], [reinit]): captured items, the
 * provider and its connection, the resource pack, the action engine, commands. The stores
 * that outlive a reload (menu sessions, navigation history, cooldowns) are created once, by
 * [prepare].
 */
internal class RuntimeAssembly(
    private val plugin: ArtisanPlugin,
    private val suite: SuiteDatabase,
    private val editorHost: EditorHost,
) {
    private val logger get() = plugin.logger
    private val server get() = plugin.server
    private val dataFolder get() = plugin.dataFolder
    private val scheduler get() = plugin.scheduler
    private val api get() = plugin.api
    private val description get() = plugin.description
    private val projectRoots get() = plugin.projectRoots
    private val assetCatalog get() = plugin.assetCatalog
    private val placeholders get() = plugin.placeholders
    private val menuEvents get() = plugin.menuEvents
    private val menuWindows get() = plugin.menuWindows
    private val serverConfigAccess get() = plugin.serverConfigAccess
    private val localEditorBundles get() = plugin.localEditorBundles
    private val editorChannel get() = editorHost.editorChannel
    private val serverId get() = suite.serverId
    private var menuProvider: net.artisanmc.plugin.engine.MenuProvider
        get() = plugin.menuProvider
        set(value) { plugin.menuProvider = value }
    private var capturedItems: net.artisanmc.plugin.items.CapturedItemStore
        get() = plugin.capturedItems
        set(value) { plugin.capturedItems = value }

    lateinit var executor: ActionExecutor
        private set
    lateinit var sessions: MenuSessionStore
        private set
    lateinit var navigationHistory: NavigationHistoryStore
        private set
    lateinit var commandRegistrar: CommandRegistrar
        private set
    private lateinit var commandOverrides: net.artisanmc.plugin.command.CommandOverrideStore
    private lateinit var cooldowns: CooldownStore
    private lateinit var evaluator: ConditionEvaluator
    /** The event-registered resource-pack manager — swapped (not stacked) on `/artisan reload`. */
    @Volatile
    private var resourcePackManager: net.artisanmc.plugin.resourcepack.ResourcePackManager? = null
    /** Reloads asked after the start (`api.project.reload()`, a root registered): disk reads and YAML off the game threads. */
    private val reloadExecutor = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "Artisan-reload").apply { isDaemon = true } }

    /** Null until the first [start]: module actions arriving before it are dropped. */
    val executorOrNull: ActionExecutor? get() = if (::executor.isInitialized) executor else null
    val sessionsOrNull: MenuSessionStore? get() = if (::sessions.isInitialized) sessions else null
    /** Null until the first [start]: module conditions tested before it fail closed. */
    val evaluatorOrNull: ConditionEvaluator? get() = if (::evaluator.isInitialized) evaluator else null

    /** The stores that outlive a reload, the asset index (from its disk cache) and the command registrar. */
    fun prepare(langManager: LangManager) {
        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        navigationHistory = NavigationHistoryStore()
        // Disk-cached asset index: glyph/font titles render from the last pack, even offline.
        plugin.assetCatalog = net.artisanmc.plugin.resourcepack.AssetCatalog(
            cacheFile = java.io.File(dataFolder, "cache/asset-index.json"),
        )
        assetCatalog.loadFromDisk()
        commandOverrides = net.artisanmc.plugin.command.CommandOverrideStore(
            { (menuProvider as? SyncedMenuProvider)?.projectDirs() ?: projectRoots.all() }, logger,
        )
        commandRegistrar = CommandRegistrar(
            plugin, langManager, scheduler,
            playerCommands = { api.playerCommands.declarations() },
            overrides = { commandOverrides.overrides },
        )
        // A module enabled or disabled after the start: its commands come and go without a reload,
        // and the editor's System section lists the new set (a leaf tells its hub). The
        // declarations of one tick (a module's commands at its enable) rebuild the command map once.
        api.playerCommands.onChange {
            if (commandsRefreshQueued.compareAndSet(false, true)) scheduler.global {
                commandsRefreshQueued.set(false)
                commandRegistrar.refresh()
            }
            (plugin.menuProviderOrNull as? SyncedMenuProvider)?.notifyModulesChanged()
        }
        // Listed with the modules' actions (owner `artisan`): the editor builds its form from the declaration.
        val moduleCommand = net.artisanmc.plugin.command.ModuleCommandAction({ commandRegistrar.moduleCommands }, langManager, logger)
        api.actionRegistry.unregister(net.artisanmc.plugin.command.ModuleCommandAction.NAME)
        api.actionRegistry.bindOwner("artisan")
        try {
            api.actionRegistry.register(moduleCommand.declaration())
        } finally {
            api.actionRegistry.bindOwner(null)
        }
    }

    /**
     * Each module command without an override gets its file, the module's values commented out,
     * in its module's first folder by name (`CommandOverrideStore.seed`). Run by the provider
     * with its other disk writes, which then reloads.
     */
    private fun seedOverrides(): Boolean =
        commandOverrides.seed(api.playerCommands) { moduleId ->
            projectRoots.all().entries
                .filter { projectRoots.ownerOf(it.key) == moduleId }
                .minByOrNull { it.key }?.value
        }

    private val commandsRefreshQueued = java.util.concurrent.atomic.AtomicBoolean(false)
    private val applyQueued = java.util.concurrent.atomic.AtomicBoolean(false)
    private val applyAll = java.util.concurrent.atomic.AtomicBoolean(false)
    private val applyModules: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    /** Read on the reload thread, swapped in on the global thread; the latest read wins. */
    @Volatile private var pendingItems: Map<String, org.bukkit.inventory.ItemStack>? = null
    @Volatile private var pendingOverrides: Map<String, net.artisanmc.plugin.model.CommandOverrideYaml>? = null

    /**
     * Called on the thread that read the snapshot: the captured items and the overrides are
     * read there too, so the global thread only swaps maps and rebuilds the command map.
     * Reloads that end before it runs the first one apply once. [modules]: the modules whose
     * `onReload()` runs, null for every one.
     */
    private fun scheduleApplyReload(modules: Set<String>?) {
        pendingItems = capturedItems.read((menuProvider as? SyncedMenuProvider)?.projectDirs() ?: projectRoots.all())
        pendingOverrides = commandOverrides.read()
        if (modules == null) applyAll.set(true) else applyModules.addAll(modules)
        if (!applyQueued.compareAndSet(false, true)) return
        scheduler.onGlobal {
            applyQueued.set(false)
            val all = applyAll.getAndSet(false)
            val some = applyModules.toSet().also { applyModules.removeAll(it) }
            applyReload(if (all) null else some)
        }
    }

    /** Global thread (the command map is only safe there). No disk here: see [scheduleApplyReload]. */
    private fun applyReload(modules: Set<String>?) {
        pendingItems?.let { capturedItems.apply(it); pendingItems = null }
        pendingOverrides?.let { commandOverrides.apply(it); pendingOverrides = null }
        commandRegistrar.reload(menuProvider.runtimeProjects(), executor, evaluator)
        // Files Artisan wrote itself (override skeletons, system menus) notify no module: nothing to re-fetch.
        if (modules != null && modules.isEmpty()) return
        api.modules.active().filter { modules == null || it.id in modules }.forEach { runCatching { it.onReload() } }
        api.events.publish(ConfigReloadEvent("menus"))
    }

    fun reinit(cfg: PluginConfig) {
        // In place: the commands hold this LangManager, and add-ons their bundles.
        plugin.translations.configure(cfg.language, cfg.perPlayerLanguage)
        plugin.langManager.reload()
        menuProvider.unload()
        start(cfg)
        // ServerLoadEvent is past: the custom items hash goes from here, once the new
        // connection is up.
        scheduler.asyncLater(40L) { (menuProvider as? SyncedMenuProvider)?.notifyCustomItemsReload() }
    }

    /**
     * What `/artisan reload` rebuilds from the config: captured items, the provider and
     * its connection, the resource pack, the action engine, commands.
     * [beforeLoad] runs once the provider exists, before it connects.
     */
    fun start(cfg: PluginConfig, beforeLoad: () -> Unit = {}) {
        projectRoots.coreRoot.mkdirs()
        capturedItems = net.artisanmc.plugin.items.CapturedItemStore(projectRoots, logger)
        capturedItems.reload()
        val softDeps = SoftDepRegistry(plugin, capturedItems, placeholders)
        evaluator = ConditionEvaluator(softDeps, cooldowns)

        val provider = createProvider(cfg)
        menuProvider = provider
        beforeLoad()
        // Before load(): the first hello already carries the custom items hash. Nexo and
        // Oraxen announce their items before Artisan starts (softdepend order).
        provider.setCustomItemsManager(net.artisanmc.plugin.customitems.CustomItemsManager(CustomItemPlugins.ALL))
        val packs = net.artisanmc.plugin.resourcepack.ResourcePackManager(
            plugin = plugin,
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
        val bedrockPacks = net.artisanmc.plugin.resourcepack.BedrockPackManager(java.io.File(dataFolder, "cache/bedrock-pack"), logger)
        bedrockPacks.loadFromDisk()
        provider.setBedrockPackManager(bedrockPacks)
        plugin.geyser.follow(bedrockPacks)
        provider.load()

        executor = ActionExecutor(plugin, provider, sessions, softDeps, cooldowns, evaluator, api.commands, navigationHistory, api.actionRegistry, plugin.langManager)
        commandOverrides.reload()
        commandRegistrar.reload(provider.runtimeProjects(), executor, evaluator)
    }

    private fun createProvider(cfg: PluginConfig) = SyncedMenuProvider(
        roots            = projectRoots,
        logger           = logger,
        evaluator        = evaluator,
        sessions         = sessions,
        history          = navigationHistory,
        onReload         = ::scheduleApplyReload,
        executorProvider = { executor },
        lookupAsset      = assetCatalog::lookup,
        offsetEncoderProvider = assetCatalog::offsetEncoder,
        dataSources = api.dataSources,
        editorBundles = localEditorBundles::find,
        templates = { api.templates },
        seedLang = { api.translations.defaultLang },
        seedOverrides = ::seedOverrides,
        announcement = plugin::announcement,
        announcementChanged = plugin::announcementChanged,
        declaredModels = { api.models.declared().map { it.document } },
        scheduler = scheduler,
        menuWindows = menuWindows,
        pluginVersion = description.version,
        nexoGlyphs = net.artisanmc.plugin.customitems.NexoGlyphReader(java.io.File(dataFolder.parentFile, "Nexo")),
        serverConfig = serverConfigAccess,
        editorEvents = { editorChannel.relay(it, serverId.toString()) },
        hub = editorHost.hubLink(cfg.web),
        isBedrock = plugin.geyser::isBedrock,
        peers = { editorHost.peerLinks },
        menuEvents = menuEvents,
        onSnapshot = suite::recordVersions,
        reloadExecutor = reloadExecutor,
    )

    /**
     * Registered once: each event targets the current provider, so `/artisan reload`
     * does not stack one more listener per reload.
     */
    fun registerCustomItemsReloadListeners() {
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
        }, plugin)

        // Hot reload: the event each installed custom-items plugin fires once its items reload.
        for (custom in CustomItemPlugins.ALL) {
            if (mgr.getPlugin(custom.pluginName) == null) continue
            try {
                @Suppress("UNCHECKED_CAST")
                val eventClass = Class.forName(custom.itemsLoadedEvent) as Class<out org.bukkit.event.Event>
                mgr.registerEvent(
                    eventClass,
                    object : org.bukkit.event.Listener {},
                    org.bukkit.event.EventPriority.NORMAL,
                    { _, event ->
                        if (eventClass.isInstance(event)) {
                            notify()
                        }
                    },
                    plugin,
                )
            } catch (_: Exception) {
                logger.warning("${custom.pluginName} found but could not register hot-reload listener")
            }
        }
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
        server.pluginManager.registerEvents(manager, plugin)
        resourcePackManager = manager
    }

    /** No reload is accepted after this; those already queued still run. */
    fun stopReloads() {
        reloadExecutor.shutdown()
    }
}
