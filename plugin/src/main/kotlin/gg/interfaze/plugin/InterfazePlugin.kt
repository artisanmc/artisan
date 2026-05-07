package gg.interfaze.plugin

import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.engine.ActionExecutor
import gg.interfaze.plugin.engine.ConditionEvaluator
import gg.interfaze.plugin.engine.CooldownStore
import gg.interfaze.plugin.engine.MenuSessionStore
import gg.interfaze.plugin.engine.SoftDepRegistry
import gg.interfaze.plugin.provider.MenuProvider
import gg.interfaze.plugin.provider.SyncedMenuProvider
import gg.interfaze.plugin.render.MenuListener
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set
    private lateinit var ifzCommand: IfzCommand
    private val sessions = MenuSessionStore()

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val serverRoot = dataFolder.parentFile.parentFile
        val packsDir = File(serverRoot, cfg.packsDir).also { it.mkdirs() }
        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
        )
        menuProvider.load()
        ifzCommand = IfzCommand(this)
        getCommand("ifz")?.setExecutor(ifzCommand)
        getCommand("ifz")?.tabCompleter = ifzCommand
        val deps = SoftDepRegistry(this)
        val cooldowns = CooldownStore()
        val evaluator = ConditionEvaluator(deps, cooldowns)
        val executor = ActionExecutor(this, menuProvider, sessions, deps, cooldowns, evaluator)
        server.pluginManager.registerEvents(MenuListener(sessions, executor), this)
        logger.info("Interfaze ${description.version} enabled")
    }

    override fun onDisable() {
        ifzCommand.shutdown()
        menuProvider.unload()
        logger.info("Interfaze disabled")
    }

    fun reinit(cfg: PluginConfig) {
        menuProvider.unload()
        val packsDir = File(dataFolder.parentFile.parentFile, cfg.packsDir).also { it.mkdirs() }
        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
        )
        menuProvider.load()
    }
}
