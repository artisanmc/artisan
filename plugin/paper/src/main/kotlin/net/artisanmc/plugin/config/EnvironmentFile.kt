package net.artisanmc.plugin.config

import org.bukkit.configuration.ConfigurationSection
import java.io.File

private val ENV_REF = Regex("""\$\{([A-Za-z_][A-Za-z0-9_]*)}""")

/** Read by the plugin only: never sent to the editor, never written by it. */
object EnvironmentFile {
    /** Writes the documented template once; an existing `environment.yml` is never rewritten. */
    fun prepare(environmentFile: File) {
        if (environmentFile.exists()) return
        environmentFile.parentFile?.mkdirs()
        environmentFile.writeText(TEMPLATE)
    }

    fun resolve(value: String, env: (String) -> String? = System::getenv, onMissing: (String) -> Unit = {}): String =
        ENV_REF.replace(value) { match ->
            val name = match.groupValues[1]
            env(name) ?: "".also { onMissing(name) }
        }

    fun string(section: ConfigurationSection, key: String, default: String, onMissing: (String) -> Unit = {}): String =
        resolve(section.getString(key) ?: default, onMissing = onMissing)

    private val TEMPLATE = """
        |# Where and who this server is. Read by the Artisan plugin only: never sent
        |# to the editor, never written by it. Everything else lives in config.yml.
        |# Any value may reference an environment variable: "${'$'}{NAME}".
        |
        |# This server's name in the editor; empty uses the server folder name.
        |# Behind Velocity, use its name in velocity.toml: letters, digits, _ and - only.
        |name: ""
        |
        |# Web editor served by this server. Changes apply after a restart.
        |#   port   : the only port to open; players never need it, admins do
        |#   bind   : empty listens on every interface, "127.0.0.1" behind a reverse proxy
        |#   url    : public address put in /artisan editor links, e.g. "https://editor.example.com";
        |#            empty uses the address the player joined with
        |# In a network, one server is the hub and serves the editor for all of them:
        |#   hub    : on every other server, the hub's address and web port, e.g. "10.0.0.5:8765";
        |#            empty means this server is the hub
        |#   secret : shared by the hub and the other servers; empty uses the Velocity forwarding
        |#            secret, else the hub generates one in plugins/Artisan/network-secret
        |web:
        |  enabled: true
        |  port: 8765
        |  bind: ""
        |  url: ""
        |  hub: ""
        |  secret: ""
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
