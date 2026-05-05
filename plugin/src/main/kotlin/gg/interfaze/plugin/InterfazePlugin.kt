package gg.interfaze.plugin

import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.provider.FilesystemMenuProvider
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val packsDir = File(dataFolder.parentFile, config.getString("packs_dir", "plugins/Interfaze/packs")!!)
        packsDir.mkdirs()
        menuProvider = FilesystemMenuProvider(packsDir)
        menuProvider.load()
        getCommand("ifz")?.setExecutor(IfzCommand(this))
        logger.info("Interfaze ${description.version} enabled — packs loaded from $packsDir")
    }

    override fun onDisable() {
        logger.info("Interfaze disabled")
    }
}
