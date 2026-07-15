package net.artisanmc.plugin.config

import org.bukkit.configuration.file.FileConfiguration

/** `wss://host[:port]/ws/plugin` → `https://host[:port]`. Blank in → blank out. */
fun deriveHttpBaseUrl(wsUrl: String): String {
    if (wsUrl.isBlank()) return ""
    val http = wsUrl
        .replaceFirst(Regex("^wss://"), "https://")
        .replaceFirst(Regex("^ws://"), "http://")
    val schemeEnd = http.indexOf("://").let { if (it >= 0) it + 3 else 0 }
    val pathStart = http.indexOf('/', schemeEnd)
    return if (pathStart >= 0) http.substring(0, pathStart) else http
}

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
    /**
     * HTTP(S) origin of the backend, derived from [wsUrl]: `wss://host/ws/plugin`
     * → `https://host`. Used before linking (no hello_ack yet) to POST the
     * `/artisan link` redeem and to point `/artisan editor` at the editor home.
     * Empty when [wsUrl] is blank.
     */
    val httpBaseUrl: String get() = deriveHttpBaseUrl(wsUrl)

    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey         = cfg.getString("server_key", "") ?: "",
            wsUrl             = cfg.getString("ws_url", "wss://editor.artisan.gg/ws/plugin") ?: "",
            editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
            language          = cfg.getString("language", "en") ?: "en",
            perPlayerLanguage = cfg.getBoolean("per_player_language", false),
            resourcePack      = ResourcePackConfig(
                enabled        = cfg.getBoolean("resource-pack.enabled", true),
                prompt         = cfg.getString("resource-pack.prompt", "<gold>Pack Artisan</gold>") ?: "<gold>Pack Artisan</gold>",
                sendOnJoin     = cfg.getBoolean("resource-pack.send-on-join", true),
                sendDelayTicks = cfg.getLong("resource-pack.send-delay-ticks", 20L),
                delegateToDir  = cfg.getString("resource-pack.delegate-to-dir")?.takeIf { it.isNotBlank() },
                delegateReloadCommand = cfg.getString("resource-pack.delegate-reload-command")?.takeIf { it.isNotBlank() },
            ),
        )
    }
}
