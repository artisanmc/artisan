package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SessionRoutesTest {
    private val sessions = Sessions()
    private val channel = EditorChannel(null).also { sessions.onClosed(it::disconnect) }
    private val servers = Servers(RemoteServer("hub-1", "survie", publicUrl = { "" }))
    private val router = Router().also { SessionRoutes(servers, sessions, channel::online).register(it) }
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"), router, sessions,
        EditorAssets(javaClass.classLoader), channel, Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()

    @AfterTest
    fun stop() = hub.stop()

    private fun base() = "http://127.0.0.1:${hub.port}"

    private fun send(method: String, path: String, cookie: String): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI(base() + path)).method(method, HttpRequest.BodyPublishers.noBody()).header("Cookie", cookie)
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun login(name: String, permissions: Set<String>): String {
        val token = (sessions.issueLink(UUID.randomUUID(), name, permissions, "hub-1") as Sessions.LinkResult.Issued).token
        val response = client.send(HttpRequest.newBuilder(URI("${base()}/login/$token")).GET().build(), HttpResponse.BodyHandlers.ofString())
        return response.headers().firstValue("Set-Cookie").get().substringBefore(';')
    }

    private fun list(cookie: String): List<JsonNode> =
        Call.mapper.readTree(send("GET", SessionRoutes.PATH, cookie).body()).path("sessions").toList()

    @Test
    fun `an admin sees who is signed in and who has the editor open, then closes a session`() {
        assertTrue(hub.start())
        val admin = login("Iban", EditorPermissions.ALL.toSet())
        val viewer = login("Steve", setOf(EditorPermissions.VIEW))
        assertEquals(403, send("GET", SessionRoutes.PATH, viewer).statusCode(), "listing needs artisan.editor.config")

        val closed = CompletableFuture<Int>()
        val socket = client.newWebSocketBuilder().header("Cookie", viewer)
            .buildAsync(URI("ws://127.0.0.1:${hub.port}/ws/editor"), object : WebSocket.Listener {
                override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
                    closed.complete(statusCode)
                    return null
                }
            }).get(5, TimeUnit.SECONDS)

        val listed = list(admin).associateBy { it.path("playerName").asText() }
        assertEquals(setOf("Iban", "Steve"), listed.keys)
        assertTrue(listed.getValue("Iban").path("current").asBoolean())
        assertEquals(false, listed.getValue("Iban").path("online").asBoolean())
        assertEquals(true, listed.getValue("Steve").path("online").asBoolean())
        assertEquals("survie", listed.getValue("Steve").path("serverLabel").asText())
        assertEquals(listOf(EditorPermissions.VIEW), listed.getValue("Steve").path("permissions").map { it.asText() })

        val id = listed.getValue("Steve").path("id").asText()
        assertEquals(404, send("DELETE", "${SessionRoutes.PATH}/${id.take(12)}", admin).statusCode(), "the API takes the full id")
        assertEquals(200, send("DELETE", "${SessionRoutes.PATH}/$id", admin).statusCode())
        assertEquals(EditorChannel.SESSION_CLOSED, closed.get(5, TimeUnit.SECONDS), "the open tab is sent back to sign-in")
        assertEquals(401, send("GET", SessionRoutes.PATH, viewer).statusCode())
        assertEquals(listOf("Iban"), list(admin).map { it.path("playerName").asText() })
        assertEquals(404, send("DELETE", "${SessionRoutes.PATH}/$id", admin).statusCode())
        socket.abort()
    }
}
