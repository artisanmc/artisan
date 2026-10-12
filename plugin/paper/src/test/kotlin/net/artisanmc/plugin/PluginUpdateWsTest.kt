package net.artisanmc.plugin

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.update.PluginUpdater
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

class PluginUpdateWsTest {
    @Test fun `annonce sa version et repond a plugin_update`() {
        val server = MockWebServer()
        val mapper = ObjectMapper()
        val answered = CountDownLatch(1)
        var hello: JsonNode? = null
        var result: JsonNode? = null
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, reason) }
            override fun onMessage(ws: WebSocket, text: String) {
                val msg = mapper.readTree(text)
                when (msg["type"].asText()) {
                    "hello" -> {
                        hello = msg
                        ws.send("""{"type":"hello_ack"}""")
                        ws.send("""{"type":"plugin_update","request_id":"r1"}""")
                    }
                    "plugin_update_result" -> { result = msg; answered.countDown() }
                }
            }
        }))
        server.start()
        val client = WsClient(
            server.url("/ws").toString(), "key", "1.21.4",
            onMessage = {},
            pluginVersion = "1.0.3",
            pluginUpdater = { PluginUpdater.Result(true, "1.0.4") },
        )
        try {
            client.connect()
            assertTrue(answered.await(5, TimeUnit.SECONDS))
            assertEquals("1.0.3", hello!!["plugin_version"].asText())
            assertEquals("r1", result!!["request_id"].asText())
            assertTrue(result!!["ok"].asBoolean())
            assertEquals("1.0.4", result!!["version"].asText())
        } finally { client.disconnect(); server.shutdown() }
    }
}
