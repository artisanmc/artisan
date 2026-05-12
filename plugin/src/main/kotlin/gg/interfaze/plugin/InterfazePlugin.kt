package gg.interfaze.plugin

import gg.interfaze.plugin.command.CommandRegistrar
import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.lang.LangManager
import gg.interfaze.plugin.provider.MenuProvider
import gg.interfaze.plugin.provider.SyncedMenuProvider
import gg.interfaze.plugin.render.MenuListener
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set
    private lateinit var ifzCommand: IfzCommand
    private lateinit var executor: ActionExecutor
    private lateinit var sessions: MenuSessionStore
    private lateinit var cooldowns: CooldownStore
    private lateinit var commandRegistrar: CommandRegistrar
    private lateinit var assetCatalog: gg.interfaze.plugin.resourcepack.AssetCatalog
    lateinit var langManager: LangManager
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val packsDir = File(dataFolder, "packs").also { it.mkdirs() }

        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)

        val softDeps = SoftDepRegistry(this)
        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        val evaluator = ConditionEvaluator(softDeps, cooldowns)
        assetCatalog = gg.interfaze.plugin.resourcepack.AssetCatalog()

        commandRegistrar = CommandRegistrar(this, langManager)
        menuProvider = SyncedMenuProvider(
            packsDir         = packsDir,
            serverKey        = cfg.serverKey,
            wsUrl            = cfg.wsUrl,
            logger           = logger,
            evaluator        = evaluator,
            sessions         = sessions,
            onReload         = { commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator) },
            executorProvider = { executor },
            lookupAsset      = assetCatalog::lookup,
            offsetEncoderProvider = assetCatalog::offsetEncoder,
        )
        // Inject before load() so the initial hello includes the correct custom_items_hash.
        // Nexo/Oraxen fire their "items loaded" events before Interfaze enables (softdepend order),
        // so registering hot-reload listeners alone is not sufficient for the first startup.
        val pluginsDir = server.pluginsFolder
        val customItemsManager = gg.interfaze.plugin.customitems.CustomItemsManager(
            listOf(
                gg.interfaze.plugin.customitems.NexoSource(pluginsDir),
                gg.interfaze.plugin.customitems.OraxenSource(pluginsDir),
                gg.interfaze.plugin.customitems.ItemsAdderSource(pluginsDir),
            )
        )
        val syncedProvider = menuProvider as? SyncedMenuProvider
        syncedProvider?.setCustomItemsManager(customItemsManager)
        val resourcePackManager = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
        )
        syncedProvider?.setResourcePackManager(resourcePackManager)
        server.pluginManager.registerEvents(resourcePackManager, this)
        menuProvider.load()
        if (syncedProvider != null) registerCustomItemsReloadListeners(syncedProvider)

        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)

        ifzCommand = IfzCommand(this, langManager)
        getCommand("ifz")?.setExecutor(ifzCommand)
        getCommand("ifz")?.tabCompleter = ifzCommand
        server.pluginManager.registerEvents(MenuListener(sessions, executor), this)
        logger.info("Interfaze ${description.version} enabled")
    }

    override fun onDisable() {
        ifzCommand.shutdown()
        commandRegistrar.unregisterAll()
        menuProvider.unload()
        logger.info("Interfaze disabled")
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
                server.scheduler.runTaskLaterAsynchronously(this@InterfazePlugin, Runnable {
                    provider.notifyCustomItemsReload()
                }, 40L)
            }
        }, this)

        if (mgr.getPlugin("Nexo") != null) {
            // Hot-reload listener: fires on /nexo reload during runtime
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: com.nexomc.nexo.api.events.NexoItemsLoadedEvent) {
                    server.scheduler.runTaskAsynchronously(this@InterfazePlugin, Runnable {
                        provider.notifyCustomItemsReload()
                    })
                }
            }, this)
        }

        if (mgr.getPlugin("Oraxen") != null) {
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: io.th0rgal.oraxen.api.events.OraxenItemsLoadedEvent) {
                    server.scheduler.runTaskAsynchronously(this@InterfazePlugin, Runnable {
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
                            server.scheduler.runTaskAsynchronously(this@InterfazePlugin, Runnable {
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

    fun reinit(cfg: PluginConfig) {
        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)
        menuProvider.unload()
        val packsDir = File(dataFolder, "packs").also { it.mkdirs() }

        val softDeps = SoftDepRegistry(this)
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            packsDir         = packsDir,
            serverKey        = cfg.serverKey,
            wsUrl            = cfg.wsUrl,
            logger           = logger,
            evaluator        = evaluator,
            sessions         = sessions,
            onReload         = { commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator) },
            executorProvider = { executor },
            lookupAsset      = assetCatalog::lookup,
            offsetEncoderProvider = assetCatalog::offsetEncoder,
        )
        val pluginsDirReinit = server.pluginsFolder
        val customItemsManagerReinit = gg.interfaze.plugin.customitems.CustomItemsManager(
            listOf(
                gg.interfaze.plugin.customitems.NexoSource(pluginsDirReinit),
                gg.interfaze.plugin.customitems.OraxenSource(pluginsDirReinit),
                gg.interfaze.plugin.customitems.ItemsAdderSource(pluginsDirReinit),
            )
        )
        val syncedProviderReinit = menuProvider as? SyncedMenuProvider
        syncedProviderReinit?.setCustomItemsManager(customItemsManagerReinit)
        val resourcePackManagerReinit = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
        )
        syncedProviderReinit?.setResourcePackManager(resourcePackManagerReinit)
        server.pluginManager.registerEvents(resourcePackManagerReinit, this)
        menuProvider.load()
        if (syncedProviderReinit != null) registerCustomItemsReloadListeners(syncedProviderReinit)
        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
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
}
