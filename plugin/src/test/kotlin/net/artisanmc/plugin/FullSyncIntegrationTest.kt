package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.SyncMetadata
import okhttp3.WebSocket
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.nio.file.Files
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.test.*

/**
 * Full-stack integration tests: plugin ↔ MockWebServer simulating the backend.
 * Each test owns its own MockWebServer, packsDir, and SyncedMenuProvider.
 */
class FullSyncIntegrationTest {

    private val mapper = ObjectMapper()

    private fun makeLogger(logs: MutableList<String>): Logger {
        val log = Logger.getLogger("artisan.integ.${System.nanoTime()}")
        log.useParentHandlers = false
        log.level = Level.ALL
        log.addHandler(object : Handler() {
            init { level = Level.ALL }
            override fun publish(r: LogRecord) { logs.add(r.message) }
            override fun flush() {}
            override fun close() {}
        })
        return log
    }

    private fun packFiles(packId: String) = mapOf(
        "plugins/Artisan/projects/$packId/manifest.yaml" to "schema: manifest/v1\nproject_id: $packId\n",
        "plugins/Artisan/projects/$packId/menus/shop.yaml" to "id: shop\nsize: 27\n",
    )

    private fun helloAck(server: MockWebServer, packId: String, backendHash: String, needsSync: Boolean = true) =
        mapper.writeValueAsString(mapOf(
            "type"                to "hello_ack",
            "session_id"          to "s_integ",
            "server_id"           to "srv_integ",
            "tier"                to "free",
            "needs_sync"          to needsSync,
            "latest_bundle_hash"  to backendHash,
            "api_url"             to server.url("/api").toString(),
            "project_hashes"      to mapOf(packId to backendHash),
        ))

    private fun bundleAvailable(server: MockWebServer, packId: String, backendHash: String) =
        mapper.writeValueAsString(mapOf(
            "type"      to "bundle_available",
            "project_id" to packId,
            "url"       to server.url("/api/v1/bundles/$packId").toString(),
            "hash"      to backendHash,
            "signature" to "",
        ))

    // -------------------------------------------------------------------------

    @Test
    fun `bundle_available triggers download — files written to disk and SyncMetadata updated`() {
        MockBukkit.mock()
        try {
            val packId = "p_dl_integ"
            val backendHash = "deadbeef001"
            val files = packFiles(packId)
            val packsDir = Files.createTempDirectory("artisan_integ_dl_").toFile()

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                    override fun onMessage(ws: WebSocket, text: String) {
                        val node = mapper.readTree(text)
                        if (node["type"]?.asText() == "hello") {
                            ws.send(helloAck(server, packId, backendHash))
                            ws.send(bundleAvailable(server, packId, backendHash))
                        }
                    }
                }))
                server.enqueue(
                    MockResponse()
                        .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to backendHash)))
                        .setHeader("Content-Type", "application/json")
                )
                server.start()

                val provider = SyncedMenuProvider(
                    roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
                    serverKey = "sk_test",
                    wsUrl     = server.url("/ws/plugin").toString(),
                    logger    = null,
                )
                provider.load()

                // Poll until files appear on disk (async download on OkHttp dispatcher thread)
                val manifest = File(packsDir, "$packId/manifest.yaml")
                val deadline = System.currentTimeMillis() + 5_000
                while (!manifest.exists() && System.currentTimeMillis() < deadline) Thread.sleep(100)

                assertTrue(manifest.exists(), "manifest.yaml should be written by BundleDownloader")
                assertTrue(File(packsDir, "$packId/menus/shop.yaml").exists())
                assertEquals("schema: manifest/v1\nproject_id: $packId\n", manifest.readText())

                val meta = SyncMetadata.read(File(packsDir, packId))
                assertEquals(backendHash, meta.backendHash)
                assertNotEquals("", meta.syncedHash, "syncedHash must be set after sync")

                provider.unload()
            }
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test
    fun `LOCAL_ONLY detected when local files edited but backend unchanged`() {
        MockBukkit.mock()
        try {
            val packId = "p_local_integ"
            val packsDir = Files.createTempDirectory("artisan_integ_local_").toFile()

            // Simulate a previous successful sync
            val packDir = File(packsDir, packId).apply { mkdirs() }
            File(packDir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $packId\n")
            val syncedHash = BundleHasher.hash(packDir)
            SyncMetadata.recordSync(packDir, syncedHash = syncedHash, backendHash = syncedHash)

            // Local edit — disk hash now differs from syncedHash
            File(packDir, "manifest.yaml").appendText("\n# local edit\n")
            assertNotEquals(syncedHash, BundleHasher.hash(packDir))

            val logs = Collections.synchronizedList(mutableListOf<String>())
            val ackLatch = CountDownLatch(1)

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                    override fun onMessage(ws: WebSocket, text: String) {
                        val node = mapper.readTree(text)
                        if (node["type"]?.asText() == "hello") {
                            // Backend hash = syncedHash (backend didn't change)
                            ws.send(helloAck(server, packId, syncedHash, needsSync = false))
                            ackLatch.countDown()
                        }
                    }
                }))
                server.start()

                val provider = SyncedMenuProvider(
                    roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
                    serverKey = "sk_test",
                    wsUrl     = server.url("/ws/plugin").toString(),
                    logger    = makeLogger(logs),
                )
                provider.load()

                assertTrue(ackLatch.await(5, TimeUnit.SECONDS), "Mock server did not receive hello within 5s")
                Thread.sleep(200) // let the client process hello_ack

                assertTrue(
                    logs.any { it.contains("differs from backend") && it.contains("LOCAL_ONLY") },
                    "Expected LOCAL_ONLY divergence WARN log. Got: $logs",
                )
                provider.unload()
            }
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test
    fun `CONFLICT detected when both local files and backend changed since last sync`() {
        MockBukkit.mock()
        try {
            val packId = "p_conflict_integ"
            val packsDir = Files.createTempDirectory("artisan_integ_conflict_").toFile()

            // Simulate a previous sync
            val packDir = File(packsDir, packId).apply { mkdirs() }
            File(packDir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $packId\n")
            val syncedHash = BundleHasher.hash(packDir)
            SyncMetadata.recordSync(packDir, syncedHash = syncedHash, backendHash = syncedHash)

            // Local edit
            File(packDir, "manifest.yaml").appendText("\n# local edit\n")

            // Backend also changed independently
            val newBackendHash = "new_backend_hash_conflict_xyz"

            val logs = Collections.synchronizedList(mutableListOf<String>())
            val ackLatch = CountDownLatch(1)

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                    override fun onMessage(ws: WebSocket, text: String) {
                        val node = mapper.readTree(text)
                        if (node["type"]?.asText() == "hello") {
                            ws.send(helloAck(server, packId, newBackendHash, needsSync = true))
                            ackLatch.countDown()
                        }
                    }
                }))
                server.start()

                val provider = SyncedMenuProvider(
                    roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
                    serverKey = "sk_test",
                    wsUrl     = server.url("/ws/plugin").toString(),
                    logger    = makeLogger(logs),
                )
                provider.load()

                assertTrue(ackLatch.await(5, TimeUnit.SECONDS), "Mock server did not receive hello within 5s")
                Thread.sleep(200)

                assertTrue(
                    logs.any { it.contains("CONFLICT") },
                    "Expected CONFLICT warning in logs. Got: $logs",
                )
                provider.unload()
            }
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test
    fun `auto-push at hello when disk pack non-empty and backend reports empty hash`() {
        MockBukkit.mock()
        try {
            val packId = "p_auto_push"
            val packsDir = Files.createTempDirectory("artisan_auto_").toFile()
            val packDir = File(packsDir, packId).apply { mkdirs() }
            File(packDir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $packId\n")
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/m.yaml").writeText("id: m\nsize: 27\n")

            val received = Collections.synchronizedList(mutableListOf<Map<String, Any>>())
            val helloLatch = CountDownLatch(1)

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                    override fun onMessage(ws: WebSocket, text: String) {
                        val node = mapper.readTree(text)
                        val type = node["type"]?.asText()
                        when (type) {
                            "hello" -> {
                                // Reply with hello_ack reporting empty backend hash for the local pack
                                ws.send(mapper.writeValueAsString(mapOf(
                                    "type" to "hello_ack",
                                    "session_id" to "sess_test",
                                    "needs_sync" to false,
                                    "project_hashes" to mapOf(packId to ""),
                                    "deleted_project_ids" to emptyList<String>(),
                                )))
                                helloLatch.countDown()
                            }
                            "local_push" -> {
                                @Suppress("UNCHECKED_CAST")
                                received.add(mapper.readValue(text, Map::class.java) as Map<String, Any>)
                            }
                        }
                    }
                }))
                server.start()

                val provider = SyncedMenuProvider(
                    roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
                    serverKey = "sk_auto_test",
                    wsUrl = server.url("/ws/plugin").toString(),
                    logger = null,
                )
                provider.load()

                assertTrue(helloLatch.await(5, TimeUnit.SECONDS), "hello not received within 5s")
                // Give the auto-push dispatcher a moment to fire
                Thread.sleep(500)

                val push = received.firstOrNull { it["type"] == "local_push" }
                assertNotNull(push, "Expected an auto-pushed local_push message. Received: $received")
                assertEquals(packId, push!!["project_id"])

                provider.unload()
            }
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test
    fun `hello payload contains protocol_version 1 and core_version`() {
        MockBukkit.mock()
        try {
            val packsDir = Files.createTempDirectory("artisan_proto_").toFile()
            val helloFrames = Collections.synchronizedList(mutableListOf<String>())
            val helloLatch = CountDownLatch(1)

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                    override fun onMessage(ws: WebSocket, text: String) {
                        val node = mapper.readTree(text)
                        if (node["type"]?.asText() == "hello") {
                            helloFrames.add(text)
                            helloLatch.countDown()
                            ws.send(mapper.writeValueAsString(mapOf(
                                "type" to "hello_ack",
                                "session_id" to "sess_proto",
                                "needs_sync" to false,
                                "project_hashes" to emptyMap<String, String>(),
                                "deleted_project_ids" to emptyList<String>(),
                            )))
                        }
                    }
                }))
                server.start()

                val provider = SyncedMenuProvider(
                    roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
                    serverKey = "sk_proto_test",
                    wsUrl = server.url("/ws/plugin").toString(),
                    logger = null,
                )
                provider.load()

                assertTrue(helloLatch.await(5, TimeUnit.SECONDS), "hello not received within 5s")

                val frame = helloFrames.firstOrNull()
                assertNotNull(frame, "Expected a hello frame")
                assertTrue(frame!!.contains("\"protocol_version\":\"1\""),
                    "hello payload must contain protocol_version:1, got: $frame")
                assertTrue(frame.contains("\"core_version\":\"1.0.0\""),
                    "hello payload must contain core_version:1.0.0, got: $frame")
                assertTrue(frame.contains("\"plugin_version\":\"1.0.0\""),
                    "hello payload must still contain plugin_version for backward compat, got: $frame")

                provider.unload()
            }
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test
    fun `plugin logs WARN on divergence and never sends pack_divergence_detected (Plan 1C)`() {
        val packsDir = Files.createTempDirectory("artisan_div_").toFile()
        val packDir = File(packsDir, "p_local").also { it.mkdirs() }
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m.yaml").writeText("id: m\n")

        // Seed SyncMetadata avec "old_synced_hash" pour que detectSyncAction == LOCAL_ONLY
        // (disk diverges from synced; backend matches synced)
        net.artisanmc.plugin.sync.SyncMetadata.recordSync(packDir,
            syncedHash = "old_synced_hash", backendHash = "old_synced_hash")

        val logs = Collections.synchronizedList(mutableListOf<String>())
        val sent = mutableListOf<Map<String, Any>>()
        val provider = net.artisanmc.plugin.provider.SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
            serverKey = "",  // skip WsClient.connect
            wsUrl = "ws://noop",
            logger = makeLogger(logs),
        )
        provider.setSendForTesting { raw ->
            val parsed = com.fasterxml.jackson.databind.ObjectMapper().readValue(raw, Map::class.java)
            @Suppress("UNCHECKED_CAST")
            sent.add(parsed as Map<String, Any>)
        }

        // hello_ack: backend hash == last_synced → disk differs → LOCAL_ONLY
        val ack = """{"type":"hello_ack","project_hashes":{"p_local":"old_synced_hash"},"deleted_project_ids":[],"bundle_url":"http://backend"}"""
        provider.handleMessageForTesting(ack)

        Thread.sleep(300)  // settle any background dispatcher

        // Plan 1C: no WS emission anymore — only a WARN log.
        kotlin.test.assertNull(
            sent.firstOrNull { it["type"] == "pack_divergence_detected" },
            "Plan 1C plugin must NOT send pack_divergence_detected",
        )
        kotlin.test.assertTrue(
            logs.any { it.contains("p_local") && it.contains("differs from backend") },
            "Expected WARN log mentioning the divergence. Got: $logs",
        )
    }
}
