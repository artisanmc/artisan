package net.artisanmc.plugin.config

import org.bukkit.configuration.file.YamlConfiguration
import java.io.File

const val DEFAULT_WS_URL = "wss://api.artisanmc.net/ws/plugin"
private val KEYS = listOf("server_key", "ws_url")

/**
 * `connection.yml` holds the plugin ↔ backend link, apart from `config.yml`
 * which the editor may rewrite (ADR `server-config-from-editor`).
 */
object ConnectionFile {
    /** Creates `connection.yml`, moving keys a pre-split `config.yml` still carries. */
    fun prepare(configFile: File, connectionFile: File) {
        val config = YamlConfiguration.loadConfiguration(configFile)
        val legacy = KEYS.filter { config.contains(it, true) }
        if (legacy.isEmpty() && connectionFile.exists()) return

        val current = YamlConfiguration.loadConfiguration(connectionFile)
        fun value(key: String, default: String) =
            current.getString(key) ?: config.getString(key) ?: default
        connectionFile.parentFile?.mkdirs()
        connectionFile.writeText(render(value("server_key", ""), value("ws_url", DEFAULT_WS_URL)))

        if (legacy.isNotEmpty()) {
            legacy.forEach { config.set(it, null) }
            config.save(configFile)
        }
    }

    private fun quote(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    private fun render(serverKey: String, wsUrl: String) = """
        |# Link between this server and the Artisan backend. Never written by the
        |# editor; everything else lives in config.yml.
        |
        |# Secret written by /artisan link. Keep it private.
        |server_key: ${quote(serverKey)}
        |
        |# Backend endpoint for live sync (WebSocket). Not the editor URL.
        |# Leave server_key empty to run offline using only local projects.
        |ws_url: ${quote(wsUrl)}
        |""".trimMargin()
}
