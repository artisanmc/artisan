package net.artisanmc.plugin.hub

import java.net.ServerSocket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HubServerTest {
    private val sessions = Sessions()
    private val router = Router().apply {
        on("GET", "/api/v1/ping/:name", EditorPermissions.VIEW) { it.json(mapOf("hello" to it.params["name"], "player" to it.session!!.playerName)) }
        on("PUT", "/api/v1/ping", EditorPermissions.EDIT) { it.json(mapOf("ok" to true)) }
    }
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"), router, sessions,
        EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()

    @AfterTest
    fun stop() = hub.stop()

    private fun base() = "http://127.0.0.1:${hub.port}"

    private fun get(path: String, cookie: String? = null): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI(base() + path)).GET()
        cookie?.let { request.header("Cookie", it) }
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun login(permissions: Set<String> = EditorPermissions.ALL.toSet()): String {
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", permissions) as Sessions.LinkResult.Issued).token
        val response = get("/login/$token")
        assertEquals(302, response.statusCode())
        assertEquals("/", response.headers().firstValue("Location").get())
        val setCookie = response.headers().firstValue("Set-Cookie").get()
        assertTrue("HttpOnly" in setCookie && "SameSite=Strict" in setCookie, setCookie)
        return setCookie.substringBefore(';')
    }

    @Test
    fun `serves the editor and falls back to index for client routes`() {
        assertTrue(hub.start())
        assertEquals("console.log(1)\n", get("/assets/app-abc123.js").body())
        assertTrue("immutable" in get("/assets/app-abc123.js").headers().firstValue("Cache-Control").get())
        assertTrue("<title>editor</title>" in get("/servers/local/projects/shop").body())
        assertEquals(404, get("/api/v1/nothing").statusCode())
    }

    @Test
    fun `api requires a session opened by a one-time link`() {
        assertTrue(hub.start())
        assertEquals(401, get("/api/v1/ping/x").statusCode())
        val cookie = login()
        val response = get("/api/v1/ping/x", cookie)
        assertEquals(200, response.statusCode())
        assertEquals("""{"hello":"x","player":"Iban"}""", response.body())
    }

    @Test
    fun `a link works once`() {
        assertTrue(hub.start())
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", setOf(EditorPermissions.VIEW)) as Sessions.LinkResult.Issued).token
        assertEquals("/", get("/login/$token").headers().firstValue("Location").get())
        assertEquals("/login?expired=1", get("/login/$token").headers().firstValue("Location").get())
    }

    @Test
    fun `permissions and origin are checked`() {
        assertTrue(hub.start())
        val viewer = login(setOf(EditorPermissions.VIEW))
        val put = { cookie: String, origin: String ->
            client.send(
                HttpRequest.newBuilder(URI(base() + "/api/v1/ping")).PUT(HttpRequest.BodyPublishers.noBody())
                    .header("Cookie", cookie).header("Origin", origin).build(),
                HttpResponse.BodyHandlers.ofString(),
            ).statusCode()
        }
        assertEquals(403, put(viewer, base()))
        val editor = login()
        assertEquals(200, put(editor, base()))
        assertEquals(403, put(editor, "http://evil.example"))
    }

    @Test
    fun `behind HTTPS the session cookie is __Host- and wins over a tossed one`() {
        assertTrue(hub.start())
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet()) as Sessions.LinkResult.Issued).token
        val response = client.send(
            HttpRequest.newBuilder(URI(base() + "/login/$token")).header("X-Forwarded-Proto", "https").GET().build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        val setCookie = response.headers().firstValue("Set-Cookie").get()
        assertTrue(setCookie.startsWith("${HubServer.SECURE_COOKIE}=") && "Secure" in setCookie, setCookie)
        // A page on a sibling subdomain can only set the unprefixed name: the hub reads the __Host- one first.
        val cookies = "${HubServer.COOKIE}=forged; " + setCookie.substringBefore(';')
        assertEquals(200, get("/api/v1/ping/x", cookies).statusCode())
    }

    @Test
    fun `a busy port leaves the plugin without editor`() {
        ServerSocket(0).use { taken ->
            val busy = HubServer(
                WebConfig(port = taken.localPort, bind = "127.0.0.1"), router, sessions,
                EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
            )
            assertFalse(busy.start())
            busy.stop()
        }
    }
}
