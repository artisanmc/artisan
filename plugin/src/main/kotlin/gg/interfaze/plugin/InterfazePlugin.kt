package gg.interfaze.plugin

import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.provider.CloudMenuProvider
import gg.interfaze.plugin.provider.FilesystemMenuProvider
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        menuProvider = when (cfg.mode) {
            "cloud" -> CloudMenuProvider(cfg.wsUrl, cfg.serverKey, logger)
            else    -> FilesystemMenuProvider(File(dataFolder.parentFile, cfg.packsDir).also { it.mkdirs() })
        }
        menuProvider.load()
        getCommand("ifz")?.setExecutor(IfzCommand(this))
        logger.info("Interfaze ${description.version} enabled (mode=${cfg.mode})")
    }

    override fun onDisable() {
        menuProvider.unload()
        logger.info("Interfaze disabled")
    }
}
