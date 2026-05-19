package gg.interfaze.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class ResourcePackConfig(
    val enabled: Boolean,
    val prompt: String,
    val sendOnJoin: Boolean,
    val sendDelayTicks: Long,
    val delegateToDir: String?,
    val delegateReloadCommand: String?,
)

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val editorConsoleOnly: Boolean,
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey         = cfg.getString("server_key", "") ?: "",
            wsUrl             = cfg.getString("ws_url", "wss://editor.interfaze.gg/ws/plugin") ?: "",
            editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
            language          = cfg.getString("language", "en") ?: "en",
            perPlayerLanguage = cfg.getBoolean("per_player_language", false),
            resourcePack      = ResourcePackConfig(
                enabled        = cfg.getBoolean("resource-pack.enabled", true),
                prompt         = cfg.getString("resource-pack.prompt", "<gold>Pack Interfaze</gold>") ?: "<gold>Pack Interfaze</gold>",
                sendOnJoin     = cfg.getBoolean("resource-pack.send-on-join", true),
                sendDelayTicks = cfg.getLong("resource-pack.send-delay-ticks", 20L),
                delegateToDir  = cfg.getString("resource-pack.delegate-to-dir")?.takeIf { it.isNotBlank() },
                delegateReloadCommand = cfg.getString("resource-pack.delegate-reload-command")?.takeIf { it.isNotBlank() },
            ),
        )
    }
}
