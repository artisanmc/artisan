package net.artisanmc.plugin.config

import net.artisanmc.plugin.hub.WebConfig
import org.bukkit.configuration.file.FileConfiguration

/** `ws://host[:port]/ws/plugin` → `http://host[:port]`, the hub's HTTP origin. Blank in → blank out. */
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
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
    val web: WebConfig = WebConfig(),
) {
    companion object {
        fun from(cfg: FileConfiguration, environment: FileConfiguration = cfg): PluginConfig {
            return PluginConfig(
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
                web = WebConfig(
                    enabled = environment.getBoolean("web.enabled", true),
                    port = environment.getInt("web.port", 8765),
                    bind = EnvironmentFile.string(environment, "web.bind", ""),
                    url = EnvironmentFile.string(environment, "web.url", "").trimEnd('/'),
                    role = if (environment.getString("web.role") == WebConfig.LEAF) WebConfig.LEAF else WebConfig.HUB,
                    name = EnvironmentFile.string(environment, "web.name", ""),
                    hubUrl = EnvironmentFile.string(environment, "web.hub-url", ""),
                    secret = EnvironmentFile.string(environment, "web.secret", ""),
                ),
            )
        }
    }
}
