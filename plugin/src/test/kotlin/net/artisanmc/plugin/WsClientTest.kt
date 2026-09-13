package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.ws.WsClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WsClientTest {
    @Test
    fun `reconnect reports current project identity and rename receipts`() {
        val server = MockWebServer()
        val hellos = java.util.concurrent.CopyOnWriteArrayList<String>()
        val projectId = java.util.concurrent.atomic.AtomicReference("old")
        val received = CountDownLatch(2)
        repeat(2) {
            server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    hellos.add(text)
                    received.countDown()
                    if (hellos.size == 1) {
                        projectId.set("new")
                        ws.close(1012, "restart")
                    }
                }
            }))
        }
        server.start()
        val client = WsClient(
            url = server.url("/ws/plugin").toString(), serverKey = "test", mcVersion = "1.21.4",
            localProjectIds = listOf("stale_constructor_snapshot"), onMessage = {},
            projectPresence = { mapOf("local_project_ids" to listOf(projectId.get()), "capabilities" to listOf("project_rename")) },
        )
        try {
            client.connect()
            assertTrue(received.await(8, TimeUnit.SECONDS))
            val mapper = ObjectMapper()
            assertEquals(listOf("old", "new"), hellos.map { mapper.readTree(it)["local_project_ids"][0].asText() })
            assertEquals("project_rename", mapper.readTree(hellos.last())["capabilities"][0].asText())
        } finally {
            client.disconnect()
            server.shutdown()
        }
    }

    @Test
    fun `sends hello on connect and receives hello_ack`() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
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

    @Test
    fun `sends installed_modules in hello`() {
        val server = MockWebServer()
        val helloText = java.util.concurrent.atomic.AtomicReference<String>()
        val latch = CountDownLatch(1)
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    helloText.set(text)
                    latch.countDown()
                }
            })
        )
        server.start()

        val client = WsClient(
            url = server.url("/ws/plugin").toString(),
            serverKey = "sk_test",
            mcVersion = "1.21.4",
            currentBundleHash = "",
            installedModules = {
                listOf(
                    mapOf("id" to "menus", "version" to "1.0.0"),
                    mapOf("id" to "commands", "version" to "1.0.0"),
                )
            },
            dataSources = {
                listOf(mapOf("ref" to "shop:items", "schema_hint" to "id, name, price"))
            },
            editorScreens = {
                listOf(mapOf(
                    "id" to "boutique:catalog",
                    "module_id" to "boutique",
                    "label" to "Catalogue",
                    "table" to "data/categories",
                    "project_id" to "boutique",
                ))
            },
            onMessage = {},
        )
        client.connect()
        assertTrue(latch.await(5, TimeUnit.SECONDS), "Expected hello within 5s")
        val hello = helloText.get()
        assertTrue(hello.contains("installed_modules"), "hello must carry installed_modules")
        assertTrue(hello.contains("menus") && hello.contains("commands"), "hello must list both core modules")

        @Suppress("UNCHECKED_CAST")
        val parsed = ObjectMapper().readValue(hello, Map::class.java) as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val ds = parsed["data_sources"] as List<Map<String, Any?>>
        assertEquals("shop:items", ds.single()["ref"])
        assertEquals("id, name, price", ds.single()["schema_hint"])

        @Suppress("UNCHECKED_CAST")
        val screens = parsed["editor_screens"] as List<Map<String, Any?>>
        assertEquals("boutique:catalog", screens.single()["id"])
        assertEquals("data/categories", screens.single()["table"])
        assertEquals("boutique", screens.single()["project_id"])

        client.disconnect()
        server.shutdown()
    }
}
