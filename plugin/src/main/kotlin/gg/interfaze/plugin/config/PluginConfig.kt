package gg.interfaze.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class PluginConfig(
    val mode: String,
    val serverKey: String,
    val wsUrl: String,
    val packsDir: String,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            mode      = cfg.getString("mode", "local") ?: "local",
            serverKey = cfg.getString("server_key", "") ?: "",
            wsUrl     = cfg.getString("ws_url", "wss://editor.interfaze.gg/ws/plugin") ?: "",
            packsDir  = cfg.getString("packs_dir", "plugins/Interfaze/packs") ?: "",
        )
    }
}
