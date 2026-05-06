package gg.interfaze.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val packsDir: String,
    val editorConsoleOnly: Boolean,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey         = cfg.getString("server_key", "") ?: "",
            wsUrl             = cfg.getString("ws_url", "wss://editor.interfaze.gg/ws/plugin") ?: "",
            packsDir          = cfg.getString("packs_dir", "plugins/Interfaze/packs") ?: "",
            editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
        )
    }
}
