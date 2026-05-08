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
        val serverRoot = dataFolder.parentFile.parentFile
        val packsDir = File(serverRoot, cfg.packsDir).also { it.mkdirs() }

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
            langManager      = langManager,
            onReload         = { commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator) },
            executorProvider = { executor },
        )
        menuProvider.load()

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

    fun reinit(cfg: PluginConfig) {
        langManager = LangManager.fromPlugin(this, cfg.language, cfg.perPlayerLanguage)
        menuProvider.unload()
        val packsDir = File(dataFolder.parentFile.parentFile, cfg.packsDir).also { it.mkdirs() }

        val softDeps = SoftDepRegistry(this)
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            packsDir         = packsDir,
            serverKey        = cfg.serverKey,
            wsUrl            = cfg.wsUrl,
            logger           = logger,
            evaluator        = evaluator,
            sessions         = sessions,
            langManager      = langManager,
            onReload         = { commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator) },
            executorProvider = { executor },
        )
        menuProvider.load()
        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
        commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
    }
}
