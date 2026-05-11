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

        // Universal startup sync: 10 s after server "Done", regardless of which
        // custom-items plugin is installed. Custom-item plugins write their pack
        // files shortly after their own load events (Nexo's PackGenerator is async),
        // so we wait a beat before reading. This is the ONLY path that computes
        // the initial custom items hash — SyncedMenuProvider.load() no longer does
        // it synchronously, so the server starts fast even with 1700+ items.
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: org.bukkit.event.server.ServerLoadEvent) {
                server.scheduler.runTaskLaterAsynchronously(this@InterfazePlugin, Runnable {
                    provider.notifyCustomItemsReload()
                }, 200L) // 200 ticks = 10 s
            }
        }, this)

        if (mgr.getPlugin("Nexo") != null) {
            // Hot-reload listener: fires on /nexo reload during runtime
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: com.nexomc.nexo.api.events.NexoItemsLoadedEvent) {
                    provider.notifyCustomItemsReload()
                }
            }, this)
        }

        if (mgr.getPlugin("Oraxen") != null) {
            mgr.registerEvents(object : org.bukkit.event.Listener {
                @org.bukkit.event.EventHandler
                fun on(event: io.th0rgal.oraxen.api.events.OraxenItemsLoadedEvent) {
                    provider.notifyCustomItemsReload()
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
                    { _, event -> if (eventClass.isInstance(event)) provider.notifyCustomItemsReload() },
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
        menuProvider.load()
        if (syncedProviderReinit != null) registerCustomItemsReloadListeners(syncedProviderReinit)
        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
    }
}
