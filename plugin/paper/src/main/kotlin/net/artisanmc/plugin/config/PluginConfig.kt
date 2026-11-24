package net.artisanmc.plugin.config

import net.artisanmc.plugin.hub.AiConfig
import net.artisanmc.plugin.hub.PackCdn
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
    /** Without a delegate folder, Artisan sends its pack to players itself. */
    val enabled: Boolean = true,
    /** MiniMessage prompt; null: `resource_pack.prompt` of the player's language. */
    val prompt: String? = null,
    /** A player who declines the pack is disconnected. */
    val required: Boolean = false,
    val sendOnJoin: Boolean = true,
    val sendDelayTicks: Long = 20L,
)

/** The `stats` section of `config.yml` (ADR `stats-foundation`). */
data class StatsConfig(
    val settings: net.artisanmc.plugin.stats.StatsSettings = net.artisanmc.plugin.stats.StatsSettings(),
    val flushSeconds: Int = 30,
    val retention: net.artisanmc.plugin.stats.StatsRetention = net.artisanmc.plugin.stats.StatsRetention(),
    /** Where a day is cut; the server's zone when `stats.timezone` is empty or unknown. */
    val zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
) {
    companion object {
        fun from(cfg: org.bukkit.configuration.ConfigurationSection): StatsConfig = StatsConfig(
            settings = net.artisanmc.plugin.stats.StatsSettings(
                enabled = cfg.getBoolean("stats.enabled", true),
                disabledEvents = cfg.getStringList("stats.disabled-events").toSet(),
            ),
            flushSeconds = cfg.getInt("stats.flush-seconds", 30).coerceIn(5, 600),
            retention = net.artisanmc.plugin.stats.StatsRetention(
                hourlyDays = cfg.getInt("stats.retention.hourly-days", 90).coerceAtLeast(1),
                dailyDays = cfg.getInt("stats.retention.daily-days", 0).coerceAtLeast(0),
                rawDays = cfg.getInt("stats.retention.raw-days", 90).coerceAtLeast(1),
            ),
            zone = cfg.getString("stats.timezone").orEmpty().trim().takeIf { it.isNotEmpty() }
                ?.let { runCatching { java.time.ZoneId.of(it) }.getOrNull() } ?: java.time.ZoneId.systemDefault(),
        )
    }
}

/**
 * `stats-export` of `environment.yml` (ADR `stats-export`): where player metrics are pushed. Off
 * while [url] or [token] is empty.
 */
data class StatsExportConfig(
    val url: String = "",
    val token: String = "",
    val intervalSeconds: Int = 120,
) {
    val enabled: Boolean get() = url.isNotEmpty() && token.isNotEmpty()

    /** The token never reaches a log or a dump. */
    override fun toString() = "StatsExportConfig(url=$url, token=${if (token.isEmpty()) "" else "***"}, intervalSeconds=$intervalSeconds)"
}

data class PluginConfig(
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
    val web: WebConfig = WebConfig(),
    /** `dev.editor-bundles` (environment.yml): module id → the file its editor view is read from. */
    val devEditorBundles: Map<String, String> = emptyMap(),
    val stats: StatsConfig = StatsConfig(),
    val statsExport: StatsExportConfig = StatsExportConfig(),
    /** `menu-variants`: the server's own menu variants, on top of default, bedrock and textured. */
    val menuVariants: net.artisanmc.plugin.engine.ServerVariants.Parsed =
        net.artisanmc.plugin.engine.ServerVariants.Parsed(net.artisanmc.plugin.engine.ServerVariants(), emptyList()),
) {
    companion object {
        fun from(cfg: FileConfiguration, environment: FileConfiguration = cfg): PluginConfig {
            return PluginConfig(
                language          = cfg.getString("language", "en") ?: "en",
                perPlayerLanguage = cfg.getBoolean("per_player_language", false),
                resourcePack      = ResourcePackConfig(
                    delegateToDir  = cfg.getString("resource-pack.delegate-to-dir")?.takeIf { it.isNotBlank() },
                    delegateReloadCommand = cfg.getString("resource-pack.delegate-reload-command")?.takeIf { it.isNotBlank() },
                    enabled        = cfg.getBoolean("resource-pack.enabled", true),
                    prompt         = cfg.getString("resource-pack.prompt")?.takeIf { it.isNotBlank() },
                    required       = cfg.getBoolean("resource-pack.required", false),
                    sendOnJoin     = cfg.getBoolean("resource-pack.send-on-join", true),
                    sendDelayTicks = cfg.getLong("resource-pack.send-delay-ticks", 20L),
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
                    tunnel = EnvironmentFile.string(environment, "web.tunnel", System.getProperty(WebConfig.TUNNEL_PROPERTY, WebConfig.DEFAULT_TUNNEL)).trim(),
                    tunnelAccess = EnvironmentFile.string(environment, "web.tunnel-access", ""),
                    packCdn = EnvironmentFile.string(environment, "web.pack-cdn", System.getProperty(PackCdn.HOST_PROPERTY, PackCdn.DEFAULT_HOST)).trim(),
                    mcp = environment.getBoolean("web.mcp", false),
                    ai = AiConfig(
                        provider = EnvironmentFile.string(environment, "ai.provider", "").trim().lowercase(),
                        apiKey = EnvironmentFile.string(environment, "ai.api-key", "").trim(),
                        model = EnvironmentFile.string(environment, "ai.model", "").trim().ifEmpty { AiConfig.DEFAULT_MODEL },
                        effort = EnvironmentFile.string(environment, "ai.effort", "").trim().lowercase().ifEmpty { "medium" },
                        maxSteps = environment.getInt("ai.max-steps", 25).coerceIn(1, 100),
                        baseUrl = EnvironmentFile.string(environment, "ai.base-url", "").trim().trimEnd('/'),
                    ),
                    site = EnvironmentFile.string(environment, "site.url", "").trim().trimEnd('/').ifEmpty { net.artisanmc.plugin.hub.SiteAccount.DEFAULT_URL },
                ),
                devEditorBundles = environment.getConfigurationSection("dev.editor-bundles")?.let { section ->
                    section.getKeys(false)
                        .associateWith { EnvironmentFile.string(section, it, "").trim() }
                        .filterValues { it.isNotEmpty() }
                }.orEmpty(),
                stats = StatsConfig.from(cfg),
                menuVariants = net.artisanmc.plugin.engine.ServerVariants.parse(cfg.getList("menu-variants")),
                statsExport = StatsExportConfig(
                    url = EnvironmentFile.string(environment, "stats-export.url", "").trim(),
                    token = EnvironmentFile.string(environment, "stats-export.token", "").trim(),
                    intervalSeconds = environment.getInt("stats-export.interval-seconds", 120).coerceIn(30, 3600),
                ),
            )
        }
    }
}
