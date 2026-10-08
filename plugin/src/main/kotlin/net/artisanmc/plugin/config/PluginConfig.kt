package net.artisanmc.plugin.config

import org.bukkit.configuration.file.FileConfiguration
import java.util.Locale

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

private const val EDITOR_HOST = "editor.artisanmc.net"
private const val API_HOST = "api.artisanmc.net"

/** `wss://fromHost:8443/x` → `wss://toHost:8443/x`; other hosts are untouched. */
private fun rewriteHost(url: String, fromHost: String, toHost: String): String {
    val schemeEnd = url.indexOf("://")
    if (schemeEnd < 0) return url
    val authorityStart = schemeEnd + 3
    val authorityEnd = url.indexOf('/', authorityStart).let { if (it >= 0) it else url.length }
    val authority = url.substring(authorityStart, authorityEnd)
    if (!authority.substringBefore(':').equals(fromHost, ignoreCase = true)) return url
    val port = authority.substringAfter(':', "")
    val rewritten = if (port.isEmpty()) toHost else "$toHost:$port"
    return url.substring(0, authorityStart) + rewritten + url.substring(authorityEnd)
}

/**
 * `editor.artisanmc.net` serves the editor SPA on nginx and never proxies `/ws`
 * or `/api` to the backend. Configs written with the old default (which pointed
 * there) made `/artisan link` fail with `http_405` and broke the WS handshake.
 * Rewrite that host to the API host; any other URL is untouched.
 */
fun normalizeWsUrl(wsUrl: String): String = rewriteHost(wsUrl, EDITOR_HOST, API_HOST)

/**
 * Browsable origin of the web editor, for the `/artisan editor` and "not linked
 * yet" hints. The backend origin ([deriveHttpBaseUrl]) is not a website, so
 * `api.artisanmc.net` maps back to `editor.artisanmc.net`. Self-hosted setups
 * keep their own origin, which serves both unless they split the two hosts.
 */
fun deriveEditorHomeUrl(wsUrl: String): String =
    rewriteHost(deriveHttpBaseUrl(wsUrl), API_HOST, EDITOR_HOST)

data class ResourcePackConfig(
    val enabled: Boolean,
    val prompt: String,
    val sendOnJoin: Boolean,
    val sendDelayTicks: Long,
    val delegateToDir: String?,
    val delegateReloadCommand: String?,
)

data class ImportSourceConfig(
    val id: String,
    val label: String,
    val path: String,
    val extensions: Set<String>,
)

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val editorConsoleOnly: Boolean,
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
    val assistantImportSources: List<ImportSourceConfig>,
    val assistantImportSourceWarnings: List<String>,
    val editorAccessMode: String = "invitation",
) {
    /**
     * HTTP(S) origin of the backend, derived from [wsUrl]: `wss://host/ws/plugin`
     * → `https://host`. Used before linking (no hello_ack yet) to POST the
     * `/artisan link` redeem. Empty when [wsUrl] is blank.
     */
    val httpBaseUrl: String get() = deriveHttpBaseUrl(wsUrl)

    /** Browsable editor origin for `/artisan editor` hints. Blank when [wsUrl] is blank. */
    val editorHomeUrl: String get() = deriveEditorHomeUrl(wsUrl)

    companion object {
        fun from(cfg: FileConfiguration, connection: FileConfiguration = cfg): PluginConfig {
            val sources = mutableListOf<ImportSourceConfig>()
            val sourceWarnings = mutableListOf<String>()
            (if (cfg.contains("assistant.import-sources", true)) {
                cfg.getConfigurationSection("assistant.import-sources")
            } else {
                null
            })
                ?.getKeys(false)
                .orEmpty()
                .sorted()
                .forEach { id ->
                    val prefix = "assistant.import-sources.$id"
                    if (!cfg.getBoolean("$prefix.enabled", true)) return@forEach

                    val path = cfg.getString("$prefix.path", "") ?: ""
                    val extensions = cfg.getStringList("$prefix.extensions")
                        .mapNotNull { extension ->
                            extension.trim()
                                .trimStart('.')
                                .takeIf { it.isNotEmpty() }
                                ?.let { ".$it".lowercase(Locale.ROOT) }
                        }
                        .toSet()
                    val problem = when {
                        !IMPORT_SOURCE_ID.matches(id) -> "invalid id"
                        path.isBlank() -> "blank path"
                        extensions.isEmpty() -> "no extensions"
                        else -> null
                    }
                    if (problem != null) {
                        sourceWarnings += "$prefix skipped: $problem"
                        return@forEach
                    }

                    sources += ImportSourceConfig(
                        id = id,
                        label = cfg.getString("$prefix.label", id) ?: id,
                        path = path,
                        extensions = extensions,
                    )
                }

            return PluginConfig(
                serverKey         = connection.getString("server_key", "") ?: "",
                wsUrl             = normalizeWsUrl(
                    connection.getString("ws_url", DEFAULT_WS_URL) ?: "",
                ),
                editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
                editorAccessMode  = if (cfg.getString("editor.access_mode") == "console") "console" else "invitation",
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
                assistantImportSources = sources,
                assistantImportSourceWarnings = sourceWarnings,
            )
        }

        private val IMPORT_SOURCE_ID = Regex("[a-z0-9][a-z0-9_-]*")
    }
}
