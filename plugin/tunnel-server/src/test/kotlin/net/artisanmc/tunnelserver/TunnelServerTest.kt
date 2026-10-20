package net.artisanmc.tunnelserver

import net.artisanmc.plugin.hub.EditorAssets
import net.artisanmc.plugin.hub.EditorChannel
import net.artisanmc.plugin.hub.EditorPermissions
import net.artisanmc.plugin.hub.HubServer
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
    private val hub = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), router, sessions, EditorAssets(javaClass.classLoader), channel, logger)
    private val tunnelServer = TunnelServer(TunnelServerConfig(domain = "tunnel.test", port = 0, bind = "127.0.0.1", publicScheme = "http", accessCode = "letmein"), logger)
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
    fun `unknown tunnels and the resource pack are not served`() {
        connect()
        call("/api/v1/ping/x", host = "nobody.tunnel.test").use { assertEquals(502, it.code) }
        call("/resource-pack/abc.zip").use { assertEquals(403, it.code) }
        call("/health", host = "tunnel.test").use { assertEquals(200, it.code) }
    }

    @Test
    fun `a private tunnel server refuses a wrong access code`() {
        assertNull(connect(access = "nope"))
        assertEquals(emptySet(), tunnelServer.connected())
    }
}
