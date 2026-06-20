package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.ws.SetupClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SetupClientTest {
    private val mapper = ObjectMapper()

    @Test
    fun `B1 — setup_request sent on open, setup_code delivered to onCode`() {
        val server = MockWebServer()
        val codeLatch = CountDownLatch(1)
        var receivedCode = ""

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(code, reason)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                assertEquals("setup_request", node["type"].asText())
                ws.send("""{"type":"setup_code","code":"ABCD1234","url":"http://localhost:5173/link?code=ABCD1234","expires_at":"2099-01-01T00:00:00Z"}""")
            }
        }))
        server.start()

        val client = SetupClient(
            url = server.url("/ws/plugin").toString(),
            code = null,
            onCode = { code, _ -> receivedCode = code; codeLatch.countDown() },
            onLinked = {},
        )
        client.connect()

        assertTrue(codeLatch.await(5, TimeUnit.SECONDS))
        assertEquals("ABCD1234", receivedCode)
        client.disconnect()
        server.shutdown()
    }

    @Test
    fun `B2 — setup_claim sent on open with code, link_confirmed delivered to onLinked`() {
        val server = MockWebServer()
        val linkedLatch = CountDownLatch(1)
        var receivedKey = ""

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(code, reason)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                assertEquals("setup_claim", node["type"].asText())
                assertEquals("ABCD1234", node["code"].asText())
                ws.send("""{"type":"link_confirmed","server_key":"sk_abc"}""")
            }
        }))
        server.start()

        val client = SetupClient(
            url = server.url("/ws/plugin").toString(),
            code = "ABCD1234",
            onCode = { _, _ -> },
            onLinked = { key -> receivedKey = key; linkedLatch.countDown() },
        )
        client.connect()

        assertTrue(linkedLatch.await(5, TimeUnit.SECONDS))
        assertEquals("sk_abc", receivedKey)
        client.disconnect()
        server.shutdown()
    }
}
