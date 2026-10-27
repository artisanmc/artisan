package net.artisanmc.tunnelserver

import net.artisanmc.plugin.hub.EditorAssets
import net.artisanmc.plugin.hub.EditorChannel
import net.artisanmc.plugin.hub.EditorPermissions
import net.artisanmc.plugin.hub.EditorServer
import net.artisanmc.plugin.hub.HubServer
import net.artisanmc.plugin.hub.PluginChannel
import net.artisanmc.plugin.hub.RemoteServer
import net.artisanmc.plugin.hub.Servers
import net.artisanmc.plugin.hub.Router
import net.artisanmc.plugin.hub.Sessions
import net.artisanmc.plugin.hub.TunnelClient
import net.artisanmc.plugin.hub.WebConfig
import net.artisanmc.tunnel.Tunnel
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A real hub and a real tunnel server on loopback; the "browser" sends the tunnel server's host names. */
class TunnelServerTest {
    private val logger = Logger.getAnonymousLogger()
    private val sessions = Sessions()
    private val channel = EditorChannel(null)
    private val router = Router().apply {
        on("GET", "/api/v1/ping/:name", EditorPermissions.VIEW) { it.json(mapOf("hello" to it.params["name"], "player" to it.session!!.playerName)) }
        on("PUT", "/api/v1/size", EditorPermissions.EDIT) { it.json(mapOf("size" to (it.bytes(8 * 1024 * 1024)?.size ?: -1))) }
        on("GET", "/api/v1/big", EditorPermissions.VIEW) { it.send(200, "application/octet-stream", ByteArray(3 * 1024 * 1024 + 7) { i -> i.toByte() }) }
    }
    private val local = object : EditorServer {
        override val id = "u-hub"
        override val online = true
        override val link = net.artisanmc.plugin.protocol.ServerLink { CompletableFuture.completedFuture(mapOf("ok" to true)) }
        override val label = "Hub"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun announcement() = net.artisanmc.plugin.protocol.ServerAnnouncement.EMPTY
        override fun serverConfig() = null
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) {}
    }
    private val servers = Servers(local, newRemote = { id, name -> RemoteServer(id, name, publicUrl = { "" }) })
    private val plugins = PluginChannel(servers, "s3cret", sessions, channel, { "" }, null, { "db-1" })
    private val hub = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), router, sessions, EditorAssets(javaClass.classLoader), channel, logger, plugins)
    private var tunnelServer = TunnelServer(TunnelServerConfig(domain = "tunnel.test", port = 0, bind = "127.0.0.1", publicScheme = "http", accessCode = "letmein"), logger)
    private val secret = "a".repeat(43)
    private val id = Tunnel.id(secret)
    private val host = "$id.tunnel.test"
    private var tunnel: TunnelClient? = null
    private val browser = OkHttpClient.Builder().followRedirects(false).build()

    @AfterTest
    fun stop() {
        tunnel?.stop()
        tunnelServer.stop()
        hub.stop()
    }

    /** Starts everything; the address the tunnel server gave, or null if refused. */
    private fun connect(access: String = "letmein"): String? {
        assertTrue(hub.start())
        tunnelServer.start()
        val url = LinkedBlockingQueue<String>()
        tunnel = TunnelClient("http://127.0.0.1:${tunnelServer.port}", secret, access, { hub.port }, logger) { it?.let(url::offer) }
            .also { it.start() }
        return url.poll(5, TimeUnit.SECONDS)
    }

    private fun call(path: String, method: String = "GET", cookie: String? = null, origin: String? = null, body: ByteArray? = null, host: String = this.host): Response {
        val request = Request.Builder().url("http://127.0.0.1:${tunnelServer.port}$path").header("Host", host)
            .apply { cookie?.let { header("Cookie", it) } }
            .apply { origin?.let { header("Origin", it) } }
            .method(method, body?.toRequestBody(null))
            .build()
        return browser.newCall(request).execute()
    }

    private fun login(): String {
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet()) as Sessions.LinkResult.Issued).token
        call("/login/$token").use { response ->
            assertEquals(302, response.code)
            return response.header("Set-Cookie")!!.substringBefore(';')
        }
    }

    @Test
    fun `the tunnel server gives a stable address derived from the secret`() {
        assertEquals("http://$id.tunnel.test", connect())
        assertEquals(setOf(id), tunnelServer.connected())
    }

    @Test
    fun `requests keep the hub's own rules through the tunnel server`() {
        connect()
        call("/api/v1/ping/x").use { assertEquals(401, it.code) }
        val cookie = login()
        call("/api/v1/ping/x", cookie = cookie).use {
            assertEquals(200, it.code)
            assertEquals("""{"hello":"x","player":"Iban"}""", it.body!!.string())
        }
        // The browser's Host goes through: the hub's same-origin check still holds.
        call("/api/v1/size", "PUT", cookie, "http://$host", ByteArray(10)).use { assertEquals(200, it.code) }
        call("/api/v1/size", "PUT", cookie, "http://evil.example", ByteArray(10)).use { assertEquals(403, it.code) }
    }

    @Test
    fun `large bodies go both ways in chunks`() {
        connect()
        val cookie = login()
        call("/api/v1/size", "PUT", cookie, "http://$host", ByteArray(2 * 1024 * 1024 + 3)).use {
            assertEquals("""{"size":2097155}""", it.body!!.string())
        }
        call("/api/v1/big", cookie = cookie).use {
            val bytes = it.body!!.bytes()
            assertEquals(3 * 1024 * 1024 + 7, bytes.size)
            assertTrue(bytes.withIndex().all { (i, b) -> b == i.toByte() })
        }
    }

    @Test
    fun `the editor WebSocket goes through, with the hub's checks`() {
        connect()
        val cookie = login()
        val received = LinkedBlockingQueue<String>()
        val opened = CountDownLatch(1)
        val socket = browser.newWebSocket(
            Request.Builder().url("http://127.0.0.1:${tunnelServer.port}/ws/editor").header("Host", host)
                .header("Cookie", cookie).header("Origin", "http://$host").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = opened.countDown()
                override fun onMessage(webSocket: WebSocket, text: String) { received.offer(text) }
            },
        )
        assertTrue(opened.await(5, TimeUnit.SECONDS))
        // The hub registers the socket when its own side opens: give it the time to.
        Thread.sleep(200)
        channel.broadcast(mapOf("type" to "ping"))
        assertEquals("""{"type":"ping"}""", received.poll(5, TimeUnit.SECONDS))
        socket.close(1000, null)

        val refused = LinkedBlockingQueue<Int>()
        browser.newWebSocket(
            Request.Builder().url("http://127.0.0.1:${tunnelServer.port}/ws/editor").header("Host", host).build(),
            object : WebSocketListener() {
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { refused.offer(response?.code ?: -1) }
            },
        )
        assertEquals(403, refused.poll(5, TimeUnit.SECONDS))
    }

    @Test
    fun `unknown tunnels are not served, the resource pack goes through`() {
        connect()
        call("/api/v1/ping/x", host = "nobody.tunnel.test").use {
            // 503, not 502: Cloudflare replaces an origin 502 with its own "Bad gateway" page.
            assertEquals(503, it.code)
            assertEquals("text/plain; charset=utf-8", it.header("Content-Type"))
        }
        val page = Request.Builder().url("http://127.0.0.1:${tunnelServer.port}/").header("Host", "nobody.tunnel.test")
            .header("Accept", "text/html,application/xhtml+xml").header("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8").build()
        browser.newCall(page).execute().use {
            assertEquals(503, it.code)
            assertEquals("30", it.header("Retry-After"))
            val html = it.body!!.string()
            assertTrue(html.contains("Ce serveur Minecraft est hors ligne"), html)
            assertTrue(html.contains("nobody.tunnel.test"))
        }
        // Leaves download the pack from their hub; so do players in direct sending, through web.url.
        call("/resource-pack/abc.zip").use { assertEquals(503, it.code) } // the hub's own answer: no pack store here
        call("/health", host = "tunnel.test").use { assertEquals(200, it.code) }
        call("/health", host = "connect.tunnel.test").use { assertEquals(200, it.code) }
    }

    @Test
    fun `a leaf with no port to its hub joins it through the hub's tunnel`() {
        connect()
        val received = LinkedBlockingQueue<String>()
        val leaf = browser.newWebSocket(
            Request.Builder().url("http://127.0.0.1:${tunnelServer.port}/ws/plugin").header("Host", host).build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) { received.offer(text) }
            },
        )
        leaf.send(
            """{"type":"hello","server_key":"s3cret","proxy_name":"survie","server_uuid":"u-survie","protocol_version":"1",""" +
                """"database_id":"db-1","minecraft_version":"1.21.4","plugin_version":"2.0.0","installed_modules":[]}""",
        )
        assertTrue(received.poll(5, TimeUnit.SECONDS)!!.contains("\"server_id\":\"u-survie\""))
        assertTrue(servers.all().any { it.id == "u-survie" && it.online })
        leaf.close(1000, null)
    }

    @Test
    fun `servers of one network share an address, one answers, a header picks one`() {
        connect()
        val other = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), Router().apply {
            on("GET", "/api/v1/whoami", null) { it.json(mapOf("server" to "ressources")) }
        }, Sessions(), EditorAssets(javaClass.classLoader), EditorChannel(null), logger)
        assertTrue(other.start())
        val url = LinkedBlockingQueue<String>()
        val second = TunnelClient("http://127.0.0.1:${tunnelServer.port}", secret, "letmein", { other.port }, logger, "u-ressources") { it?.let(url::offer) }
        try {
            second.start()
            assertEquals("http://$host", url.poll(5, TimeUnit.SECONDS), "the same address")
            // The last connected answers; the first one stays reachable by name.
            call("/api/v1/whoami").use { assertEquals(200, it.code) }
            val first = Request.Builder().url("http://127.0.0.1:${tunnelServer.port}/api/v1/whoami").header("Host", host)
                .header(Tunnel.MEMBER_HEADER, "u-nobody").build()
            browser.newCall(first).execute().use { assertEquals(503, it.code) }
            second.stop()
            Thread.sleep(300)
            call("/api/v1/whoami").use { assertEquals(404, it.code, "the first server took over") }
        } finally {
            second.stop()
            other.stop()
        }
    }

    @Test
    fun `a plugin can connect on a subdomain when the apex is another site`() {
        connect()
        val hello = LinkedBlockingQueue<String>()
        browser.newWebSocket(
            Request.Builder().url("http://127.0.0.1:${tunnelServer.port}${Tunnel.CONNECT_PATH}").header("Host", "connect.tunnel.test")
                .header("Authorization", "Bearer " + "b".repeat(43)).header(Tunnel.VERSION_HEADER, Tunnel.VERSION)
                .header(Tunnel.ACCESS_HEADER, "letmein").build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                    hello.offer(net.artisanmc.tunnel.Frame.decode(bytes.asByteBuffer()).json<net.artisanmc.tunnel.Hello>().url)
                    webSocket.close(1000, null)
                }
            },
        )
        assertEquals("http://${Tunnel.id("b".repeat(43))}.tunnel.test", hello.poll(5, TimeUnit.SECONDS))
    }

    @Test
    fun `a tunnel past its requests per minute gets 429`() {
        tunnelServer.stop()
        tunnelServer = TunnelServer(TunnelServerConfig(domain = "tunnel.test", port = 0, bind = "127.0.0.1", publicScheme = "http", accessCode = "letmein", requestsPerMinute = 2), logger)
        connect()
        call("/api/v1/ping/x").use { assertEquals(401, it.code) }
        call("/api/v1/ping/x").use { assertEquals(401, it.code) }
        call("/api/v1/ping/x").use { assertEquals(429, it.code) }
    }

    @Test
    fun `a private tunnel server refuses a wrong access code`() {
        assertNull(connect(access = "nope"))
        assertEquals(emptySet(), tunnelServer.connected())
    }
}
