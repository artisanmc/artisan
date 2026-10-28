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
        |#   session-days : days an editor sign-in stays open without use, restarts included
        |# Servers on the same MySQL/MariaDB database find each other: from any of them, the
        |# editor reaches all of them, nothing to set. To serve one editor from a single hub instead:
        |#   hub    : on every other server, the hub's address and web port, e.g. "10.0.0.5:8765";
        |#            empty means this server serves its own editor
        |#   secret : shared by the hub and the other servers; empty uses the Velocity forwarding
        |#            secret, else the hub generates one in plugins/Artisan/network-secret
        |# Without url, the hub reaches browsers through a tunnel server, with no port to open:
        |#   tunnel        : the tunnel server; links use the https address it gives
        |#                   (plugins/Artisan/tunnel-secret keeps it stable). It sees the editor's
        |#                   traffic; "" for none: browsers then reach port directly
        |#   tunnel-access : the code a private tunnel server asks for; empty for none
        |# A server of the network with no port to its hub sets hub to the hub's tunnel address
        |# (https://<id>.artisanmc.app).
        |# pack-cdn : where the hub uploads the resource pack the editor builds; players download
        |#            it from there, with no port to open. Artisan's host by default (packs are
        |#            public, kept 30 days after their last use); "" for none: players then
        |#            download it from url, or from this server's port
        |web:
        |  enabled: true
        |  port: 8765
        |  bind: ""
        |  url: ""
        |  session-days: 7
        |  hub: ""
        |  secret: ""
        |  tunnel: "connect.artisanmc.app"
        |  tunnel-access: ""
        |  pack-cdn: "cdn.artisanmc.net"
        |
        |# The editor's assistant, on your own model account (hub only). Players with
        |# artisan.editor.edit chat with it in the editor; it reads the Projects and writes
        |# drafts, which they review and deploy. Its calls are billed to this key.
        |# Changes apply after a restart.
        |#   provider  : "anthropic"; empty turns the assistant off
        |#   api-key   : e.g. "${'$'}{ANTHROPIC_API_KEY}", to keep the key out of this file
        |#   model     : empty is claude-opus-5-5
        |#   effort    : low, medium, high, xhigh or max: how hard the model thinks, and what it costs
        |#   max-steps : model calls one message may make (1 to 100)
        |# ai:
        |#   provider: "anthropic"
        |#   api-key: "${'$'}{ANTHROPIC_API_KEY}"
        |#   model: ""
        |#   effort: "medium"
        |#   max-steps: 25
        |
        |# Database shared by the plugins of the suite. Changes apply after a restart.
        |#   type      : h2      a single file, plugins/Artisan/database/suite.mv.db, nothing to set up
        |#               mysql   MySQL 8+
        |#               mariadb MariaDB 10.6+
        |#   pool-size : maximum connections of each plugin's own pool (1 to 50)
        |#   table-prefix : in front of every table of the suite (artisan_servers, artisan_quests_…).
        |#               Only to share one database between two installations; the same on every
        |#               server of a Network. Changing it later does not rename the tables: Artisan
        |#               refuses to start until you set it back or rename them.
        |database:
        |  type: "h2"
        |  host: "localhost"
        |  port: 3306
        |  name: "minecraft"
        |  user: "root"
        |  password: ""
        |  pool-size: 4
        |  table-prefix: "artisan_"
        |
        |# Development: a module's editor view read from a file on this machine instead of
        |# its jar, re-read when it changes (run `vite build --watch` in the module's editor/).
        |# Reload the editor to see it. Changes apply after a restart.
        |# dev:
        |#   editor-bundles:
        |#     msquests: "/home/me/MSQuests/bukkit/src/main/resources/artisan-editor/ui.js"
        |""".trimMargin()
}
