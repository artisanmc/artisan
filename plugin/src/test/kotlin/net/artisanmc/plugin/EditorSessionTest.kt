package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EditorSessionTest {
    private val mapper = ObjectMapper()

    @Test
    fun `requestEditorSession sends editor_session_request and delivers url via callback`() {
        val server = MockWebServer()
        val readyLatch = CountDownLatch(1)
        var receivedUrl = ""

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(code, reason)
            }

            override fun onOpen(ws: WebSocket, response: okhttp3.Response) {
                val ack = """{"type":"hello_ack","session_id":"s1","server_id":"srv1","tier":"free","needs_sync":false,"latest_bundle_hash":"","api_url":"http://localhost","pack_hashes":{}}"""
                ws.send(ack)
            }
            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                if (node["type"].asText() == "editor_session_request") {
                    ws.send("""{"type":"editor_session_ready","url":"http://localhost:5173/session?token=TESTTOKEN12345678901234567890","expires_at":"2099-01-01T00:00:00Z"}""")
                }
            }
        }))
        server.start()

        val packsDir = Files.createTempDirectory("artisan_test_packs").toFile()
        val provider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = "sk_" + "a".repeat(64),
            wsUrl     = server.url("/ws/plugin").toString(),
            logger    = null,
        )
        provider.load()
        Thread.sleep(400)

        provider.requestEditorSession("AdminPlayer") { url, _ ->
            receivedUrl = url
            readyLatch.countDown()
        }

        assertTrue(readyLatch.await(5, TimeUnit.SECONDS), "editor_session_ready not received")
        assertEquals("http://localhost:5173/session?token=TESTTOKEN12345678901234567890", receivedUrl)

        provider.unload()
        server.shutdown()
    }

    @Test
    fun `revokeEditorSessions sends editor_session_revoke`() {
        val server = MockWebServer()
        val revokeLatch = CountDownLatch(1)

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(code, reason)
            }

            override fun onOpen(ws: WebSocket, response: okhttp3.Response) {
                val ack = """{"type":"hello_ack","session_id":"s2","server_id":"srv2","tier":"free","needs_sync":false,"latest_bundle_hash":"","api_url":"http://localhost","pack_hashes":{}}"""
                ws.send(ack)
            }
            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                if (node["type"].asText() == "editor_session_revoke") revokeLatch.countDown()
            }
        }))
        server.start()

        val packsDir = Files.createTempDirectory("artisan_test_packs2").toFile()
        val provider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = "sk_" + "b".repeat(64),
            wsUrl     = server.url("/ws/plugin").toString(),
            logger    = null,
        )
        provider.load()
        Thread.sleep(400)

        provider.revokeEditorSessions()

        assertTrue(revokeLatch.await(5, TimeUnit.SECONDS), "editor_session_revoke not sent")

        provider.unload()
        server.shutdown()
    }
}
