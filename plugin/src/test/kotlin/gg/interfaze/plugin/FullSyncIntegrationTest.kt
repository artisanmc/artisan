package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import gg.interfaze.plugin.provider.SyncedMenuProvider
import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.sync.SyncMetadata
import okhttp3.WebSocket
import okhttp3.WebSocketListener
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
        val log = Logger.getLogger("ifz.integ.${System.nanoTime()}")
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
        "plugins/Interfaze/packs/$packId/manifest.yaml" to "schema: manifest/v1\npack_id: $packId\n",
        "plugins/Interfaze/packs/$packId/menus/shop.yaml" to "id: shop\nsize: 27\n",
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
            "pack_hashes"         to mapOf(packId to backendHash),
        ))

    private fun bundleAvailable(server: MockWebServer, packId: String, backendHash: String) =
        mapper.writeValueAsString(mapOf(
            "type"      to "bundle_available",
            "pack_id"   to packId,
            "url"       to server.url("/api/bundles/$packId").toString(),
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
            val packsDir = Files.createTempDirectory("ifz_integ_dl_").toFile()

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
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
                    packsDir  = packsDir,
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
                assertEquals("schema: manifest/v1\npack_id: $packId\n", manifest.readText())

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
            val packsDir = Files.createTempDirectory("ifz_integ_local_").toFile()

            // Simulate a previous successful sync
            val packDir = File(packsDir, packId).apply { mkdirs() }
            File(packDir, "manifest.yaml").writeText("schema: manifest/v1\npack_id: $packId\n")
            val syncedHash = BundleHasher.hash(packDir)
            SyncMetadata.recordSync(packDir, syncedHash = syncedHash, backendHash = syncedHash)

            // Local edit — disk hash now differs from syncedHash
            File(packDir, "manifest.yaml").appendText("\n# local edit\n")
            assertNotEquals(syncedHash, BundleHasher.hash(packDir))

            val logs = Collections.synchronizedList(mutableListOf<String>())
            val ackLatch = CountDownLatch(1)

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
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
                    packsDir  = packsDir,
                    serverKey = "sk_test",
                    wsUrl     = server.url("/ws/plugin").toString(),
                    logger    = makeLogger(logs),
                )
                provider.load()

                assertTrue(ackLatch.await(5, TimeUnit.SECONDS), "Mock server did not receive hello within 5s")
                Thread.sleep(200) // let the client process hello_ack

                assertTrue(
                    logs.any { it.contains("manually edited") },
                    "Expected LOCAL_ONLY warning in logs. Got: $logs",
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
            val packsDir = Files.createTempDirectory("ifz_integ_conflict_").toFile()

            // Simulate a previous sync
            val packDir = File(packsDir, packId).apply { mkdirs() }
            File(packDir, "manifest.yaml").writeText("schema: manifest/v1\npack_id: $packId\n")
            val syncedHash = BundleHasher.hash(packDir)
            SyncMetadata.recordSync(packDir, syncedHash = syncedHash, backendHash = syncedHash)

            // Local edit
            File(packDir, "manifest.yaml").appendText("\n# local edit\n")

            // Backend also changed independently
            val newBackendHash = "new_backend_hash_conflict_xyz"

            val logs = Collections.synchronizedList(mutableListOf<String>())
            val ackLatch = CountDownLatch(1)

            MockWebServer().use { server ->
                server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
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
                    packsDir  = packsDir,
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
}
