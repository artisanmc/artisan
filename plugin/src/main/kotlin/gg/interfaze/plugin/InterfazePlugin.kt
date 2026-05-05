package gg.interfaze.plugin

import org.bukkit.plugin.java.JavaPlugin

open class InterfazePlugin : JavaPlugin() {
    override fun onEnable() {
        logger.info("Interfaze ${description.version} enabled")
    }

    override fun onDisable() {
        logger.info("Interfaze disabled")
    }
}
