package net.artisanmc.tunnelserver

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import net.artisanmc.plugin.hub.AddressRoutes
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
import java.io.File
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Names on a real tunnel server, taken from a real hub's `/api/v1/editor-address`. */
class NamesTest {
    private val logger = Logger.getAnonymousLogger()
    private val dir: File = Files.createTempDirectory("tunnel-names").toFile()
    private val sessions = Sessions()
    private var tunnel: TunnelClient? = null
    private val router = Router().apply {
        on("GET", "/api/v1/ping", EditorPermissions.VIEW) { it.json(mapOf("player" to it.session!!.playerName)) }
        AddressRoutes({ tunnel }, sessions).register(this)
    }
    private val hub = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), router, sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), logger)
    private var tunnelServer = newTunnelServer()
    private val secret = "a".repeat(43)
    private val id = Tunnel.id(secret)
    private val urls = LinkedBlockingQueue<String>()
    private val others = mutableListOf<TunnelClient>()
    private val browser = OkHttpClient.Builder().followRedirects(false).build()
    private val json = jacksonObjectMapper()

    private fun newTunnelServer() = TunnelServer(
        TunnelServerConfig(domain = "tunnel.test", port = 0, bind = "127.0.0.1", publicScheme = "http",
            namesFile = File(dir, "names.json").path, adminToken = "admin-token"),
        logger,
    )

    @AfterTest
    fun stop() {
        others.forEach(TunnelClient::stop)
        tunnel?.stop()
        tunnelServer.stop()
        hub.stop()
        dir.deleteRecursively()
    }

    private fun connect() {
        assertTrue(hub.start())
        tunnelServer.start()
        tunnel = TunnelClient("http://127.0.0.1:${tunnelServer.port}", secret, "", { hub.port }, logger) { it?.let(urls::offer) }
            .also { it.start() }
        assertEquals("http://$id.tunnel.test", urls.poll(5, TimeUnit.SECONDS))
    }

    private fun other(secret: String): TunnelClient {
        val url = LinkedBlockingQueue<String>()
        return TunnelClient("http://127.0.0.1:${tunnelServer.port}", secret, "", { hub.port }, logger) { it?.let(url::offer) }
            .also { others += it; it.start(); assertNotNull(url.poll(5, TimeUnit.SECONDS)) }
    }

    private fun call(path: String, host: String, method: String = "GET", cookie: String? = null, body: String? = null, token: String? = null): Response {
        val request = Request.Builder().url("http://127.0.0.1:${tunnelServer.port}$path").header("Host", host)
            .apply { cookie?.let { header("Cookie", it) } }
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .apply { if (method != "GET") header("Origin", "http://$host") }
            .method(method, body?.toRequestBody(null))
            .build()
        return browser.newCall(request).execute()
    }

    private fun login(host: String, token: String = (sessions.issueLink(UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet()) as Sessions.LinkResult.Issued).token): String =
        call("/login/$token", host).use { assertEquals(302, it.code); it.header("Set-Cookie")!!.substringBefore(';') }

    private fun address(cookie: String, name: String, check: Boolean = false, host: String = "$id.tunnel.test") =
        call("/api/v1/editor-address", host, "POST", cookie, """{"name":"$name","check":$check}""").use { it.code to json.readTree(it.body!!.string()) }

    @Test
    fun `an address takes a name, both addresses answer, the new one comes with a sign-in link`() {
        connect()
        val cookie = login("$id.tunnel.test")
        call("/api/v1/editor-address", "$id.tunnel.test", cookie = cookie).use {
            val body = json.readTree(it.body!!.string())
            assertTrue(body["names"].asBoolean())
            assertTrue(body["name"].isNull)
            assertEquals(".tunnel.test", body["suffix"].asText())
        }
        assertEquals(200, address(cookie, "survie", check = true).first)
        assertNull(tunnelServer.names!!.idOf("survie"), "a check takes nothing")

        val (status, taken) = address(cookie, "Survie")
        assertEquals(200, status)
        assertEquals("http://survie.tunnel.test", taken["url"].asText())
        assertEquals("http://survie.tunnel.test", urls.poll(5, TimeUnit.SECONDS), "the plugin learns its new address")
        assertEquals("survie", tunnel!!.name)

        val link = taken["login"].asText()
        assertTrue(link.startsWith("http://survie.tunnel.test/login/"), link)
        val named = login("survie.tunnel.test", link.substringAfterLast('/'))
        call("/api/v1/ping", "survie.tunnel.test", cookie = named).use { assertEquals("""{"player":"Iban"}""", it.body!!.string()) }
        call("/api/v1/ping", "$id.tunnel.test", cookie = cookie).use { assertEquals(200, it.code, "the id keeps answering") }
    }

    @Test
    fun `names already taken, reserved or malformed are refused`() {
        connect()
        val cookie = login("$id.tunnel.test")
        assertEquals(200, address(cookie, "survie").first)
        val intruder = other("b".repeat(43))
        assertEquals("taken", intruder.requestName("survie", false).get(5, TimeUnit.SECONDS).error)
        assertEquals("reserved", intruder.requestName("connect", false).get(5, TimeUnit.SECONDS).error)
        assertEquals("reserved", intruder.requestName("paypal-secure", false).get(5, TimeUnit.SECONDS).error)
        assertEquals("invalid", intruder.requestName("ab", false).get(5, TimeUnit.SECONDS).error)
        assertEquals("invalid", intruder.requestName(Tunnel.id("c".repeat(43)), false).get(5, TimeUnit.SECONDS).error, "an id is no name")
        assertTrue(intruder.requestName("ressources", false).get(5, TimeUnit.SECONDS).ok)
        address(cookie, "ressources").let { (status, body) -> assertEquals(409, status); assertEquals("taken", body["error"].asText()) }
        address(cookie, "connect").let { (status, _) -> assertEquals(422, status) }
        // The owner gives it back: free again, the id answers alone.
        assertEquals(200, address(cookie, "").first)
        assertNull(tunnelServer.names!!.idOf("survie"))
        assertTrue(intruder.requestName("survie", false).get(5, TimeUnit.SECONDS).ok)
    }

    @Test
    fun `names survive a restart, an admin frees or bans one`() {
        connect()
        val cookie = login("$id.tunnel.test")
        assertEquals(200, address(cookie, "survie").first)
        urls.poll(5, TimeUnit.SECONDS)
        tunnel!!.stop()
        tunnelServer.stop()
        tunnelServer = newTunnelServer()
        tunnelServer.start()
        assertEquals(id, tunnelServer.names!!.idOf("survie"))

        call("/admin/names", "connect.tunnel.test").use { assertEquals(401, it.code) }
        call("/admin/names", "connect.tunnel.test", token = "admin-token").use {
            assertEquals(id, json.readTree(it.body!!.string())["names"]["survie"]["id"].asText())
        }
        call("/admin/names/survie?ban=1", "tunnel.test", "DELETE", token = "admin-token").use { assertEquals(200, it.code) }
        assertNull(tunnelServer.names!!.idOf("survie"))
        val again = other(secret)
        assertEquals("reserved", again.requestName("survie", false).get(5, TimeUnit.SECONDS).error, "banned")
        call("/admin/bans/survie", "tunnel.test", "DELETE", token = "admin-token").use { assertEquals(200, it.code) }
        assertTrue(again.requestName("survie", false).get(5, TimeUnit.SECONDS).ok)
    }

    @Test
    fun `without a names file, the tunnel server keeps no names`() {
        tunnelServer = TunnelServer(TunnelServerConfig(domain = "tunnel.test", port = 0, bind = "127.0.0.1", publicScheme = "http"), logger)
        connect()
        assertFalse(tunnel!!.names)
        assertEquals("unavailable", tunnel!!.requestName("survie", false).get(5, TimeUnit.SECONDS).error)
        call("/admin/names", "tunnel.test", token = "admin-token").use { assertEquals(404, it.code) }
    }
}
