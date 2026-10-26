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
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Worker tunnel server (`deploy/tunnel-worker`) with a real hub and the real [TunnelClient]: the plugin
 * must not see a difference. Skipped unless `ARTISAN_TUNNEL_WORKER_DOMAIN` is set.
 *
 * - Local (`npm run dev:test` in `deploy/tunnel-worker`): `ARTISAN_TUNNEL_WORKER_URL=http://127.0.0.1:8787`,
 *   `ARTISAN_TUNNEL_WORKER_DOMAIN=tunnel.test`, `ARTISAN_TUNNEL_WORKER_SCHEME=http`, `ARTISAN_TUNNEL_WORKER_ACCESS=letmein`.
 * - Deployed trial: `ARTISAN_TUNNEL_WORKER_DOMAIN=artisanmc.app`, `ARTISAN_TUNNEL_WORKER_SUFFIX=-test`.
 */
class TunnelWorkerTest {
    private val env = System.getenv()
    private val domain = env["ARTISAN_TUNNEL_WORKER_DOMAIN"].orEmpty()
    /** Where to send requests, the browser's host going in `Host`; empty: straight to the host, over HTTPS. */
    private val base = env["ARTISAN_TUNNEL_WORKER_URL"].orEmpty().trimEnd('/')
    private val suffix = env["ARTISAN_TUNNEL_WORKER_SUFFIX"].orEmpty()
    private val scheme = env["ARTISAN_TUNNEL_WORKER_SCHEME"] ?: "https"
    private val access = env["ARTISAN_TUNNEL_WORKER_ACCESS"].orEmpty()

    private val logger = Logger.getAnonymousLogger()
    private val sessions = Sessions()
    private val channel = EditorChannel(null)
    private val router = Router().apply {
        on("GET", "/api/v1/ping/:name", EditorPermissions.VIEW) { it.json(mapOf("hello" to it.params["name"], "player" to it.session!!.playerName)) }
        on("PUT", "/api/v1/size", EditorPermissions.EDIT) { it.json(mapOf("size" to (it.bytes(8 * 1024 * 1024)?.size ?: -1))) }
        on("GET", "/api/v1/big", EditorPermissions.VIEW) { it.send(200, "application/octet-stream", ByteArray(3 * 1024 * 1024 + 7) { i -> i.toByte() }) }
        on("GET", "/api/v1/whoami", null) { it.json(mapOf("server" to "hub")) }
    }
    private val hub = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), router, sessions, EditorAssets(javaClass.classLoader), channel, logger)
    /** A fresh address per run: a deployed Worker keeps what earlier runs left. */
    private val secret = UUID.randomUUID().toString() + UUID.randomUUID().toString()
    private val id = Tunnel.id(secret)
    private val host get() = "$id$suffix.$domain"
    private val tunnels = mutableListOf<TunnelClient>()
    private val browser = OkHttpClient.Builder().followRedirects(false).readTimeout(60, TimeUnit.SECONDS).build()

    @BeforeTest
    fun only() = assumeTrue(domain.isNotEmpty(), "ARTISAN_TUNNEL_WORKER_DOMAIN not set")

    @AfterTest
    fun stop() {
        tunnels.forEach { it.stop() }
        hub.stop()
    }

    private fun server() = base.ifEmpty { "https://connect$suffix.$domain" }

    private fun connect(port: () -> Int? = { hub.port }, member: String = ""): String? {
        if (hub.port == null) assertTrue(hub.start())
        val url = LinkedBlockingQueue<String>()
        tunnels += TunnelClient(server(), secret, access, port, logger, member) { it?.let(url::offer) }.also { it.start() }
        return url.poll(15, TimeUnit.SECONDS)
    }

    private fun request(path: String, host: String = this.host): Request.Builder =
        if (base.isEmpty()) Request.Builder().url("https://$host$path")
        else Request.Builder().url("$base$path").header("Host", host)

    private fun call(path: String, method: String = "GET", cookie: String? = null, origin: String? = null, body: ByteArray? = null, host: String = this.host): Response =
        browser.newCall(
            request(path, host)
                .apply { cookie?.let { header("Cookie", it) } }
                .apply { origin?.let { header("Origin", it) } }
                .method(method, body?.toRequestBody(null))
                .build(),
        ).execute()

    private fun login(): String {
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet()) as Sessions.LinkResult.Issued).token
        call("/login/$token").use { response ->
            assertEquals(302, response.code)
            return response.headers("Set-Cookie").first().substringBefore(';')
        }
    }

    @Test
    fun `the Worker gives the address derived from the secret`() {
        assertEquals("$scheme://$host", connect())
    }

    @Test
    fun `requests keep the hub's own rules through the Worker`() {
        connect()
        call("/api/v1/ping/x").use { assertEquals(401, it.code) }
        val cookie = login()
        call("/api/v1/ping/x", cookie = cookie).use {
            assertEquals(200, it.code)
            assertEquals("""{"hello":"x","player":"Iban"}""", it.body!!.string())
        }
        call("/api/v1/size", "PUT", cookie, "$scheme://$host", ByteArray(10)).use { assertEquals(200, it.code) }
        call("/api/v1/size", "PUT", cookie, "https://evil.example", ByteArray(10)).use { assertEquals(403, it.code) }
    }

    @Test
    fun `large bodies go both ways in chunks`() {
        connect()
        val cookie = login()
        call("/api/v1/size", "PUT", cookie, "$scheme://$host", ByteArray(2 * 1024 * 1024 + 3)).use {
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
            request("/ws/editor").header("Cookie", cookie).header("Origin", "$scheme://$host").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = opened.countDown()
                override fun onMessage(webSocket: WebSocket, text: String) { received.offer(text) }
            },
        )
        assertTrue(opened.await(15, TimeUnit.SECONDS))
        Thread.sleep(300)
        channel.broadcast(mapOf("type" to "ping"))
        assertEquals("""{"type":"ping"}""", received.poll(10, TimeUnit.SECONDS))
        socket.close(1000, null)

        val refused = LinkedBlockingQueue<Int>()
        browser.newWebSocket(
            request("/ws/editor").build(),
            object : WebSocketListener() {
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { refused.offer(response?.code ?: -1) }
            },
        )
        assertEquals(403, refused.poll(15, TimeUnit.SECONDS))
    }

    @Test
    fun `an address never connected gets the offline page`() {
        val nobody = Tunnel.id(UUID.randomUUID().toString().repeat(2)) + suffix
        call("/api/v1/ping/x", host = "$nobody.$domain").use {
            assertEquals(503, it.code)
            assertTrue(it.header("Content-Type")!!.startsWith("text/plain"))
        }
        browser.newCall(request("/", "$nobody.$domain").header("Accept", "text/html").header("Accept-Language", "fr-FR,fr;q=0.9").build()).execute().use {
            assertEquals(503, it.code)
            assertTrue(it.body!!.string().contains("Ce serveur Minecraft est hors ligne"))
        }
        call("/health", host = "connect$suffix.$domain").use { assertEquals(200, it.code) }
    }

    @Test
    fun `servers of one network share an address, one answers, a header picks one`() {
        connect(member = "u-hub")
        val other = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), Router().apply {
            on("GET", "/api/v1/whoami", null) { it.json(mapOf("server" to "ressources")) }
        }, Sessions(), EditorAssets(javaClass.classLoader), EditorChannel(null), logger)
        assertTrue(other.start())
        try {
            assertEquals("$scheme://$host", connect({ other.port }, "u-ressources"))
            call("/api/v1/whoami").use { assertEquals("""{"server":"ressources"}""", it.body!!.string()) }
            browser.newCall(request("/api/v1/whoami").header(Tunnel.MEMBER_HEADER, "u-hub").build()).execute().use {
                assertEquals("""{"server":"hub"}""", it.body!!.string())
            }
            tunnels.removeLast().stop()
            Thread.sleep(1000)
            call("/api/v1/whoami").use { assertEquals("""{"server":"hub"}""", it.body!!.string(), "the first server took over") }
        } finally {
            other.stop()
        }
    }

    @Test
    fun `an address takes a name and answers under it`() {
        connect()
        val name = "t" + UUID.randomUUID().toString().take(8)
        val client = tunnels.single()
        val result = client.requestName(name, false).get(15, TimeUnit.SECONDS)
        assertTrue(result.ok, result.toString())
        assertEquals("$scheme://$name$suffix.$domain", result.url)
        // The Worker reads names from KV, cached up to a minute at the edge.
        val deadline = System.currentTimeMillis() + 90_000
        var code = 0
        while (System.currentTimeMillis() < deadline) {
            code = call("/api/v1/whoami", host = "$name$suffix.$domain").use { it.code }
            if (code == 200) break
            Thread.sleep(2000)
        }
        assertEquals(200, code)
        assertTrue(client.requestName("", false).get(15, TimeUnit.SECONDS).ok)
    }

    /** Not an assertion: what one request costs through the Worker, printed for the study. */
    @Test
    fun `latency of a small request`() {
        connect()
        call("/api/v1/whoami").use { it.body!!.string() }
        val times = (1..10).map {
            val start = System.nanoTime()
            call("/api/v1/whoami").use { it.body!!.string() }
            (System.nanoTime() - start) / 1_000_000
        }.sorted()
        println("Tunnel latency through ${server()}: min ${times.first()} ms, median ${times[times.size / 2]} ms, max ${times.last()} ms")
    }
}
