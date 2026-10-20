package net.artisanmc.plugin

import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File

/**
 * The editor side of this server (ADR `editor-web-server`): on a hub, the web server, the API
 * and `/ws/plugin` ([start]); on a leaf, the link to its hub ([hubLink]); on both, the editor
 * permissions of the online players ([startPermissionReports]).
 */
internal class EditorHost(private val plugin: ArtisanPlugin, private val suite: SuiteDatabase) {
    private val logger get() = plugin.logger
    private val dataFolder get() = plugin.dataFolder
    private val server get() = plugin.server
    private val scheduler get() = plugin.scheduler
    private val database get() = plugin.database
    private val api get() = plugin.api
    private val description get() = plugin.description
    private val menuProvider get() = plugin.menuProvider
    private val editorSessions get() = plugin.editorSessions
    private val serverConfigAccess get() = plugin.serverConfigAccess
    private val serverId get() = suite.serverId
    private val serverUuid get() = plugin.serverUuid

    val editorChannel by lazy { net.artisanmc.plugin.hub.EditorChannel(logger) }
    /** Null if `web.enabled` is false or the port could not be opened. */
    @Volatile var editor: net.artisanmc.plugin.hub.HubServer? = null
        private set
    /** `web.url`; empty when not set. */
    private var configuredUrl: String = ""
    /** The https address the tunnel server gave this hub; null without tunnel server or while disconnected. */
    @Volatile private var tunnelUrl: String? = null
    private var tunnel: net.artisanmc.plugin.hub.TunnelClient? = null
    /** The editor's address for browsers: `web.url`, else the tunnel server's; empty when neither. */
    val editorUrl: String get() = configuredUrl.ifEmpty { tunnelUrl.orEmpty() }
    private var editorBind: String = ""
    private var serverName: String = ""

    /** This server as seen by the editor it serves: always the current provider, which changes on each reload. */
    private val localServer = object : net.artisanmc.plugin.hub.EditorServer {
        private val provider get() = menuProvider as SyncedMenuProvider
        override val id: String get() = serverId.toString()
        override val online = true
        override val link: net.artisanmc.plugin.protocol.ServerLink get() = provider.link
        override val label: String get() = serverName.ifBlank { "Minecraft" }
        override val minecraftVersion: String get() = provider.minecraftVersion
        override val pluginVersion: String get() = description.version
        override fun announcement() = plugin.announcement()
        override fun serverConfig() = serverConfigAccess.report()
        override fun customItems() = provider.customItems()
        override fun applyResourcePack(hash: String, path: String) {
            val port = editor?.port ?: return
            val local = editorBind.takeUnless { it.isBlank() || it == "0.0.0.0" } ?: "127.0.0.1"
            provider.applyLocalResourcePack("${packBase()}$path", "http://$local:$port$path", hash)
        }
    }

    /** The editor address for browsers: `web.url`, else the tunnel server's, else [host] or the server IP. */
    private fun editorBase(host: String? = null): String =
        editorUrl.ifEmpty { directBase(host) }

    /** Where players download the pack: never through the tunnel server, which refuses `/resource-pack/`. */
    private fun packBase(): String = configuredUrl.ifEmpty { directBase(null) }

    private fun directBase(host: String?) = "http://${host ?: server.ip.ifBlank { "localhost" }}:${editor?.port ?: 8765}"

    /**
     * Every minute, the editor permissions of the online players, read here: the hub applies them
     * to the sessions this server issued, and signs out whoever lost `artisan.editor.view`.
     */
    fun startPermissionReports(web: net.artisanmc.plugin.hub.WebConfig) {
        if (!web.enabled || (!web.leaf && editor == null)) return
        fun report() {
            if (!plugin.isEnabled) return
            scheduler.global {
                val players = server.onlinePlayers.associate { p ->
                    p.uniqueId to net.artisanmc.plugin.hub.EditorPermissions.ALL.filter(p::hasPermission).toSet()
                }
                scheduler.async {
                    if (web.leaf) (menuProvider as? SyncedMenuProvider)?.sendModuleMessage(mapOf(
                        "type" to "editor_permissions",
                        "players" to players.entries.associate { (id, perms) -> id.toString() to perms.toList() },
                    ))
                    else editorSessions.refresh(serverUuid, players)
                }
            }
            scheduler.asyncLater(HEARTBEAT_TICKS) { report() }
        }
        scheduler.asyncLater(HEARTBEAT_TICKS) { report() }
    }

    private fun networkSecret(web: net.artisanmc.plugin.hub.WebConfig): String =
        net.artisanmc.plugin.config.NetworkSecret.resolve(web.secret, File("."), File(dataFolder, "network-secret"), generate = !web.leaf)

    fun stop() {
        tunnel?.stop()
        tunnel = null
        tunnelUrl = null
        editor?.stop()
        editor = null
    }

    /** Jetty comes from `libraries:`: if it is missing (server without outbound access), the plugin runs without the editor. */
    fun start(web: net.artisanmc.plugin.hub.WebConfig) {
        configuredUrl = web.url
        editorBind = web.bind
        serverName = plugin.networkName(web).orEmpty()
        if (!web.enabled) return
        if (web.leaf) {
            logger.info("[Artisan] Editor served by the hub at ${web.hubUrl}")
            if (web.tunnel.isNotBlank()) logger.warning("[Artisan] web.tunnel is ignored on this server: only the hub opens a tunnel")
            return
        }
        try {
            val vanilla = net.artisanmc.plugin.hub.VanillaAssets(File(dataFolder, "cache/minecraft"), localServer.minecraftVersion, logger)
            val packs = net.artisanmc.plugin.hub.PackStore(File(dataFolder, "cache/resource-pack"))
            val servers = net.artisanmc.plugin.hub.Servers(localServer, suite::knownServers) { id, name ->
                net.artisanmc.plugin.hub.RemoteServer(id, name, publicUrl = { packBase() })
            }
            val prefs = net.artisanmc.plugin.hub.PlayerPrefs(File(dataFolder, "editor-prefs"))
            // The suite database may still be opening (issue #42): the routes read it once it is.
            val data = net.artisanmc.plugin.database.LateSuiteData { suite.suiteData }
            val router = net.artisanmc.plugin.hub.EditorApi.router(servers, editorSessions, logger, vanilla, packs, prefs, data.history, data.loaded, data.drafts)
            val plugins = net.artisanmc.plugin.hub.PluginChannel(servers, networkSecret(web), editorSessions, editorChannel, ::editorBase, logger, {
                if (database.dialect == net.artisanmc.modules.api.database.DatabaseDialect.H2) null
                else suite.databaseId()
            }) { suite.artisanData != null }
            val server = net.artisanmc.plugin.hub.HubServer(
                web, router, editorSessions, net.artisanmc.plugin.hub.EditorAssets(plugin.javaClass.classLoader), editorChannel, logger, plugins,
            )
            if (server.start()) {
                editor = server
                if (web.tunnel.isNotBlank()) startTunnel(web)
            }
        } catch (e: LinkageError) {
            logger.warning("[Artisan] Editor disabled: web server libraries are missing (${e.message})")
        }
    }

    /** ADR `editor-tunnel`: the hub's own web port, reached by browsers through the tunnel server. */
    private fun startTunnel(web: net.artisanmc.plugin.hub.WebConfig) {
        val secret = net.artisanmc.plugin.hub.TunnelClient.secret(File(dataFolder, "tunnel-secret"))
        tunnel = net.artisanmc.plugin.hub.TunnelClient(web.tunnel, secret, web.tunnelAccess, { editor?.port }, logger) { url ->
            tunnelUrl = url
        }.also { it.start() }
    }

    /** Only a leaf opens a WebSocket: to `web.hub`, with the network secret. */
    fun hubLink(web: net.artisanmc.plugin.hub.WebConfig): net.artisanmc.plugin.ws.HubLink? {
        if (!web.leaf) return null
        val secret = networkSecret(web).ifEmpty { return null }
        val name = plugin.networkName(web) ?: return null
        if (database.dialect == net.artisanmc.modules.api.database.DatabaseDialect.H2) {
            logger.severe("[Artisan] Not connecting to the hub: a network needs a shared MySQL or MariaDB database, this server uses H2 (database.type in environment.yml).")
            return null
        }
        // Read when the socket opens: null while the database is still opening, and the client waits for it.
        val databaseId = { suite.databaseId() }
        return net.artisanmc.plugin.ws.HubLink(web.hubUrl, secret, name, databaseId, serverId.toString())
    }
}
