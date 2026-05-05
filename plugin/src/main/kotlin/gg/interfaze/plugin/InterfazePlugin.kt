package gg.interfaze.plugin

import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.provider.MenuProvider
import gg.interfaze.plugin.provider.SyncedMenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val packsDir = File(dataFolder.parentFile, cfg.packsDir).also { it.mkdirs() }
        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
        )
        menuProvider.load()
        getCommand("ifz")?.setExecutor(IfzCommand(this))
        logger.info("Interfaze ${description.version} enabled")
    }

    override fun onDisable() {
        menuProvider.unload()
        logger.info("Interfaze disabled")
    }
}
