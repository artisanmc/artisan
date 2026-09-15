package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.ws.WsClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConsoleAccessWsTest {
    @Test fun `console mode hello and member addition round trip`() {
        val server = MockWebServer()
        val mapper = ObjectMapper()
        val ready = CountDownLatch(1)
        val closed = CountDownLatch(1)
        var peer: WebSocket? = null
        var mode = ""
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) { peer = ws }
            override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, reason) }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) { closed.countDown() }
            override fun onMessage(ws: WebSocket, text: String) {
                val msg = mapper.readTree(text)
                when (msg["type"].asText()) {
                    "hello" -> {
                        mode = msg["editor_access_mode"].asText()
                        ws.send("""{"type":"hello_ack"}""")
                    }
                    "member_add" -> {
                        assertEquals("user@example.com", msg["email"].asText())
                        ws.send(mapper.writeValueAsString(mapOf("type" to "member_add_result", "request_id" to msg["request_id"].asText(), "ok" to true)))
                    }
                }
            }
        }))
        server.start()
        val client = WsClient(server.url("/ws").toString(), "key", "1.21.4", onMessage = { ready.countDown() }, editorAccessMode = "console")
        try {
            assertEquals("offline", client.addMember("user@example.com").get())
            client.connect()
            assertTrue(ready.await(5, TimeUnit.SECONDS))
            assertEquals("console", mode)
            assertEquals("added", client.addMember("user@example.com").get(5, TimeUnit.SECONDS))
        } finally {
            try {
                peer?.close(1000, "test complete")
                assertTrue(closed.await(5, TimeUnit.SECONDS), "WebSocket closes before server shutdown")
            } finally { client.disconnect(); server.shutdown() }
        }
    }
}
