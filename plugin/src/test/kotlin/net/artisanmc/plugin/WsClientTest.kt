package net.artisanmc.plugin

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

class WsClientTest {
    @Test
    fun `sends hello on connect and receives hello_ack`() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    ws.send(
                        """{"type":"hello_ack","session_id":"s1","server_id":"srv1","tier":"free","needs_sync":false,"latest_bundle_hash":""}"""
                    )
                }
            })
        )
        server.start()

        val received = mutableListOf<String>()
        val latch = CountDownLatch(1)
        val client = WsClient(
            url = server.url("/ws/plugin").toString(),
            serverKey = "sk_test",
            mcVersion = "1.21.4",
            currentBundleHash = "",
            onMessage = { msg -> received.add(msg); latch.countDown() },
        )
        client.connect()
        assertTrue(latch.await(5, TimeUnit.SECONDS), "Expected hello_ack within 5s")
        assertEquals(1, received.size)
        assertTrue(received.first().contains("hello_ack"))
        client.disconnect()
        server.shutdown()
    }
}
