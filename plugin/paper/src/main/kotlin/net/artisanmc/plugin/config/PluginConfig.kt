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

/**
 * `web.hub` → the hub's plugin WebSocket. A bare host takes the default port 8765; an http(s)
 * address (a reverse proxy) becomes ws(s) on its own port; a ws(s) URL is kept. Blank in → blank out.
 */
fun hubWebSocketUrl(address: String): String {
    val raw = address.trim()
    if (raw.isEmpty() || raw.startsWith("ws://") || raw.startsWith("wss://")) return raw
    val scheme = if (raw.startsWith("https://")) "wss" else "ws"
    val host = raw.substringAfter("://").substringBefore('/')
    val bare = "://" !in raw && ':' !in host.substringAfterLast(']')
    return "$scheme://$host${if (bare) ":8765" else ""}/ws/plugin"
}

private val SERVER_NAME = Regex("[A-Za-z0-9_-]{1,64}")

/**
 * This server's name in the network, the one Velocity knows it by. A written `name` is kept
 * as is or refused (null): altering it would break the match with Velocity and stored locations.
 * Empty: the [folder] name, made valid.
 */
fun serverName(name: String, folder: String): String? {
    val written = name.trim()
    if (written.isNotEmpty()) return written.takeIf { SERVER_NAME.matches(it) }
    return folder.replace(Regex("[^A-Za-z0-9_-]"), "-").take(64).ifEmpty { "Minecraft" }
}

data class ResourcePackConfig(
    val delegateToDir: String?,
    val delegateReloadCommand: String?,
)

data class PluginConfig(
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
    val web: WebConfig = WebConfig(),
    /** `dev.editor-bundles` (environment.yml): module id → the file its editor view is read from. */
    val devEditorBundles: Map<String, String> = emptyMap(),
) {
    companion object {
        fun from(cfg: FileConfiguration, environment: FileConfiguration = cfg): PluginConfig {
            return PluginConfig(
                language          = cfg.getString("language", "en") ?: "en",
                perPlayerLanguage = cfg.getBoolean("per_player_language", false),
                resourcePack      = ResourcePackConfig(
                    delegateToDir  = cfg.getString("resource-pack.delegate-to-dir")?.takeIf { it.isNotBlank() },
                    delegateReloadCommand = cfg.getString("resource-pack.delegate-reload-command")?.takeIf { it.isNotBlank() },
                ),
                web = WebConfig(
                    enabled = environment.getBoolean("web.enabled", true),
                    port = environment.getInt("web.port", 8765),
                    bind = EnvironmentFile.string(environment, "web.bind", ""),
                    url = EnvironmentFile.string(environment, "web.url", "").trimEnd('/'),
                    name = EnvironmentFile.string(environment, "name", ""),
                    hubUrl = hubWebSocketUrl(EnvironmentFile.string(environment, "web.hub", "")),
                    secret = EnvironmentFile.string(environment, "web.secret", ""),
                    sessionDays = environment.getInt("web.session-days", 7).coerceAtLeast(1),
                    tunnel = EnvironmentFile.string(environment, "web.tunnel", WebConfig.DEFAULT_TUNNEL).trim(),
                    tunnelAccess = EnvironmentFile.string(environment, "web.tunnel-access", ""),
                    mcp = environment.getBoolean("web.mcp", false),
                ),
                devEditorBundles = environment.getConfigurationSection("dev.editor-bundles")?.let { section ->
                    section.getKeys(false)
                        .associateWith { EnvironmentFile.string(section, it, "").trim() }
                        .filterValues { it.isNotEmpty() }
                }.orEmpty(),
            )
        }
    }
}
