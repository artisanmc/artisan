package net.artisanmc.plugin.config

import org.bukkit.configuration.ConfigurationSection
import org.bukkit.configuration.file.YamlConfiguration
import java.io.File

const val DEFAULT_WS_URL = "wss://api.artisanmc.net/ws/plugin"
private val LINK_KEYS = listOf("server_key", "ws_url")
private val ENV_REF = Regex("""\$\{([A-Za-z_][A-Za-z0-9_]*)}""")

/** Read by the plugin only: never sent to the backend, never written by the editor. */
object EnvironmentFile {
    /** An existing `environment.yml` is never rewritten: it wins over stale copies, which are removed. */
    fun prepare(configFile: File, connectionFile: File, environmentFile: File) {
        val config = YamlConfiguration.loadConfiguration(configFile)
        val legacy = LINK_KEYS.filter { config.contains(it, true) }
        val hasConnection = connectionFile.exists()
        if (environmentFile.exists() && legacy.isEmpty() && !hasConnection) return

        if (!environmentFile.exists()) {
            val connection = YamlConfiguration.loadConfiguration(connectionFile)
            fun value(key: String, default: String) =
                connection.getString(key) ?: config.getString(key) ?: default
            environmentFile.parentFile?.mkdirs()
            environmentFile.writeText(render(value("server_key", ""), value("ws_url", DEFAULT_WS_URL)))
        }

        if (legacy.isNotEmpty()) {
            legacy.forEach { config.set(it, null) }
            config.save(configFile)
        }
        if (hasConnection) connectionFile.delete()
    }

    fun resolve(value: String, env: (String) -> String? = System::getenv, onMissing: (String) -> Unit = {}): String =
        ENV_REF.replace(value) { match ->
            val name = match.groupValues[1]
            env(name) ?: "".also { onMissing(name) }
        }

    fun string(section: ConfigurationSection, key: String, default: String, onMissing: (String) -> Unit = {}): String =
        resolve(section.getString(key) ?: default, onMissing = onMissing)

    private fun quote(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    private fun render(serverKey: String, wsUrl: String) = """
        |# Where and who this server is. Read by the Artisan plugin only: never sent
        |# to the backend, never written by the editor. Everything else lives in
        |# config.yml. Any value may reference an environment variable: "${'$'}{NAME}".
        |
        |# Secret written by /artisan link. Keep it private.
        |server_key: ${quote(serverKey)}
        |
        |# Backend endpoint for live sync (WebSocket). Not the editor URL.
        |# Leave server_key empty to run offline using only local projects.
        |ws_url: ${quote(wsUrl)}
        |
        |# Web editor served by this server. Changes apply after a restart.
        |#   port : the only port to open; players never need it, admins do
        |#   bind : empty listens on every interface, "127.0.0.1" behind a reverse proxy
        |#   url  : public address put in /artisan editor links, e.g. "https://editor.example.com";
        |#          empty uses the address the player joined with
        |web:
        |  enabled: true
        |  port: 8765
        |  bind: ""
        |  url: ""
        |
        |# Database shared by the plugins of the suite, one connection pool per plugin
        |# (pool size: database.pool-size in config.yml). Changes apply after a restart.
        |#   h2      : a single file, plugins/Artisan/database/suite.mv.db, nothing to set up
        |#   mysql   : MySQL 8+
        |#   mariadb : MariaDB 10.6+
        |database:
        |  type: "h2"
        |  host: "localhost"
        |  port: 3306
        |  name: "minecraft"
        |  user: "root"
        |  password: ""
        |""".trimMargin()
}
