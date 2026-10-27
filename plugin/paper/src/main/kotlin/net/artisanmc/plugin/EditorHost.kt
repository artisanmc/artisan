package net.artisanmc.plugin

import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File

/**
 * The editor side of this server (ADR `editor-web-server`): on a hub, the web server, the API
 * and `/ws/plugin` ([start]); on a leaf, the link to its hub ([hubLink]); on both, the editor
 * permissions of the online players ([startPermissionReports]).
 */
/** How often a server announces its address and looks for new peers (ADR `peer-servers`). */
private const val PEER_ROUND_TICKS = 20L * 30
/** How long the tunnel waits for the suite database before using this server's own address. */
private const val DATABASE_WAIT_SECONDS = 60
/** How often the hub tells the pack host its packs are still in use: it deletes them after 30 days. */
private const val PACK_REFRESH_TICKS = 20L * 3600 * 24

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
        override fun applyResourcePack(hash: String, path: String) = applyResourcePack(hash, path, null)
        override fun applyResourcePack(hash: String, path: String, url: String?) {
            val port = editor?.port ?: return
            val local = editorBind.takeUnless { it.isBlank() || it == "0.0.0.0" } ?: "127.0.0.1"
            provider.applyLocalResourcePack(url ?: "${packBase()}$path", "http://$local:$port$path", hash)
        }
    }

    /** The editor address for browsers: `web.url`, else the tunnel server's, else [host] or the server IP. */
    private fun editorBase(host: String? = null): String =
        editorUrl.ifEmpty { directBase(host) }

    /** The pack's public address, downloaded by players in direct sending: `web.url`, else the direct one. */
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

    /** The servers this hub serves, once [start] built them: what a session's origin is named after. */
    @Volatile private var hubServers: net.artisanmc.plugin.hub.Servers? = null

    /** Server id to name, for `/artisan editor sessions`; empty on a leaf. */
    fun serverLabels(): Map<String, String> = hubServers?.all()?.associate { it.id to it.label }.orEmpty()

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
            return
        }
        try {
            val vanilla = net.artisanmc.plugin.hub.VanillaAssets(File(dataFolder, "cache/minecraft"), localServer.minecraftVersion, logger)
            val packs = net.artisanmc.plugin.hub.PackStore(File(dataFolder, "cache/resource-pack"))
            val packCdn = web.packCdn.takeIf { it.isNotBlank() }?.let { net.artisanmc.plugin.hub.PackCdn(it, ::tunnelSecret, logger) }
            val servers = net.artisanmc.plugin.hub.Servers(localServer, suite::knownServers) { id, name ->
                net.artisanmc.plugin.hub.RemoteServer(id, name, publicUrl = { packBase() })
            }
            hubServers = servers
            val prefs = net.artisanmc.plugin.hub.PlayerPrefs(File(dataFolder, "editor-prefs"))
            // The suite database may still be opening (issue #42): the routes read it once it is.
            val data = net.artisanmc.plugin.database.LateSuiteData { suite.suiteData }
            // ADR `mcp-server`: AI clients write drafts for the players who approved them; `web.mcp` turns it on.
            val mcp = if (web.mcp) net.artisanmc.plugin.hub.McpGrants(suite.mcpGrantStore()).also { grants ->
                editorSessions.onPermissions(grants::permissionsChanged)
                logger.info("[Artisan] MCP endpoint enabled at /mcp")
            } else null
            val router = net.artisanmc.plugin.hub.EditorApi.router(
                servers, editorSessions, logger, vanilla, packs, prefs, data.history, data.loaded, data.drafts, { tunnel },
                mcp = mcp, ai = web.ai, version = description.version, online = editorChannel::online, packCdn = packCdn,
            )
            val plugins = net.artisanmc.plugin.hub.PluginChannel(servers, networkSecret(web), editorSessions, editorChannel, ::editorBase, logger, {
                if (database.dialect == net.artisanmc.modules.api.database.DatabaseDialect.H2) null
                else suite.databaseId()
            }, { suite.artisanData != null }, suite::peerSecret)
            val server = net.artisanmc.plugin.hub.HubServer(
                web, router, editorSessions, net.artisanmc.plugin.hub.EditorAssets(plugin.javaClass.classLoader), editorChannel, logger, plugins,
            )
            if (server.start()) {
                editor = server
                if (web.tunnel.isNotBlank() && web.url.isBlank()) startTunnel(web)
                if (database.dialect != net.artisanmc.modules.api.database.DatabaseDialect.H2) startPeerDiscovery(web)
                packCdn?.let { startPackRefresh(it, packs) }
            }
        } catch (e: LinkageError) {
            logger.warning("[Artisan] Editor disabled: web server libraries are missing (${e.message})")
        }
    }

    /** ADR `editor-tunnel`: the hub's own web port, reached by browsers through the tunnel server. */
    private fun startTunnel(web: net.artisanmc.plugin.hub.WebConfig) {
        if (database.dialect == net.artisanmc.modules.api.database.DatabaseDialect.H2) return openTunnel(web, null)
        // ADR `peer-servers`: the servers of one database share an address, from its network secret.
        // The database opens off the main thread; without it in time, this server keeps its own address.
        fun await(tries: Int) {
            if (!plugin.isEnabled || editor == null) return
            val shared = suite.peerSecret()
            when {
                shared != null -> openTunnel(web, shared)
                tries <= 0 -> openTunnel(web, null)
                else -> scheduler.asyncLater(20L) { await(tries - 1) }
            }
        }
        scheduler.async { await(DATABASE_WAIT_SECONDS) }
    }

    private fun openTunnel(web: net.artisanmc.plugin.hub.WebConfig, shared: String?) {
        val secret = tunnelSecret(shared)
        val member = if (shared != null) serverId.toString() else ""
        tunnel = net.artisanmc.plugin.hub.TunnelClient(web.tunnel, secret, web.tunnelAccess, { editor?.port }, logger, member) { url ->
            tunnelUrl = url
        }.also { it.start() }
    }

    /**
     * The tunnel's secret: the network's when servers share a database ([shared]), else this server's
     * own. The pack host counts quotas with it too, read once the database is open.
     */
    private fun tunnelSecret(
        shared: String? = suite.peerSecret().takeIf { database.dialect != net.artisanmc.modules.api.database.DatabaseDialect.H2 },
    ): String = shared?.let(net.artisanmc.plugin.hub.TunnelClient::networkSecret)
        ?: net.artisanmc.plugin.hub.TunnelClient.secret(File(dataFolder, "tunnel-secret"))

    /** At startup then daily, the hub's packs stay on the pack host, which deletes what is unused for 30 days. */
    private fun startPackRefresh(cdn: net.artisanmc.plugin.hub.PackCdn, packs: net.artisanmc.plugin.hub.PackStore) {
        val started = editor
        fun round() {
            // A reload starts another round on its own web server: this one stops.
            if (!plugin.isEnabled || editor !== started) return
            cdn.refresh(packs)
            scheduler.asyncLater(PACK_REFRESH_TICKS) { round() }
        }
        scheduler.asyncLater(20L * 60) { round() }
    }

    /** The other servers that serve their own editor, as links this server joins (ADR `peer-servers`). */
    @Volatile var peerLinks: List<net.artisanmc.plugin.ws.HubLink> = emptyList()
        private set

    /**
     * ADR `peer-servers`: servers on one MySQL/MariaDB database find each other there, with no
     * `web.hub`. Each round announces where this server's `/ws/plugin` answers, then joins every
     * other one as a leaf: its internal address first, else its public one (tunnel or `web.url`).
     */
    private fun startPeerDiscovery(web: net.artisanmc.plugin.hub.WebConfig) {
        fun round() {
            if (!plugin.isEnabled || editor == null) return
            val name = plugin.networkName(web)
            val secret = suite.peerSecret()
            if (name != null && secret != null && suite.advertise(editorUrl, internalPluginUrl())) {
                peerLinks = suite.peers().map { peer ->
                    val public = net.artisanmc.plugin.config.hubWebSocketUrl(peer.editorUrl)
                    net.artisanmc.plugin.ws.HubLink(
                        url = peer.internalUrl.ifEmpty { public }, secret = secret, serverName = name,
                        databaseId = { suite.databaseId() }, serverUuid = serverId.toString(),
                        alternates = listOf(public), peer = true,
                        // Its public address may be this network's, shared: the header picks that server.
                        headers = mapOf(net.artisanmc.plugin.hub.TunnelClient.MEMBER_HEADER to peer.uuid),
                    )
                }
                (menuProvider as? SyncedMenuProvider)?.syncPeers(peerLinks)
            }
            scheduler.asyncLater(PEER_ROUND_TICKS) { round() }
        }
        scheduler.asyncLater(20L * 5) { round() }
    }

    /** This hub's `/ws/plugin` on its own network: `web.bind` when it names one address, else this machine's. */
    private fun internalPluginUrl(): String {
        val port = editor?.port ?: return ""
        val host = editorBind.takeUnless { it.isBlank() || it == "0.0.0.0" || it == "::" }
            ?: runCatching { java.net.InetAddress.getLocalHost().hostAddress }.getOrNull() ?: return ""
        val bracketed = if (':' in host) "[$host]" else host
        return "ws://$bracketed:$port/ws/plugin"
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
