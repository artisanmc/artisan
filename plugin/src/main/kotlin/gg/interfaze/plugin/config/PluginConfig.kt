package gg.interfaze.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val editorConsoleOnly: Boolean,
    val language: String,
    val perPlayerLanguage: Boolean,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey         = cfg.getString("server_key", "") ?: "",
            wsUrl             = cfg.getString("ws_url", "wss://editor.interfaze.gg/ws/plugin") ?: "",
            editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
            language          = cfg.getString("language", "en") ?: "en",
            perPlayerLanguage = cfg.getBoolean("per_player_language", false),
        )
    }
}
