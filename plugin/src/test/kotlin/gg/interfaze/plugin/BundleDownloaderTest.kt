package gg.interfaze.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import gg.interfaze.plugin.sync.BundleDownloader
import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.sync.SyncMetadata
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BundleDownloaderTest {

    private val mapper = ObjectMapper()

    private fun makeBundle(packId: String): Map<String, String> = mapOf(
        "plugins/Interfaze/packs/$packId/manifest.yaml" to "schema: manifest/v1\npack_id: $packId\n",
        "plugins/Interfaze/packs/$packId/menus/shop.yaml" to "id: shop\nsize: 27\n",
    )

    @Test
    fun `download writes YAML files to pack dir under packsDir`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_dl_test"
            val files = makeBundle(packId)
            val responseBody = mapper.writeValueAsString(mapOf("files" to files, "hash" to "abc123"))
            server.enqueue(MockResponse().setBody(responseBody).setHeader("Content-Type", "application/json"))

            val packsDir = Files.createTempDirectory("ifz_dl_").toFile()
            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url       = server.url("/api/bundles/$packId").toString(),
                serverKey = "sk_test",
                packId    = packId,
            )

            assertTrue(File(packsDir, "$packId/manifest.yaml").exists())
            assertTrue(File(packsDir, "$packId/menus/shop.yaml").exists())
            assertEquals("schema: manifest/v1\npack_id: $packId\n",
                File(packsDir, "$packId/manifest.yaml").readText())
        }
    }

    @Test
    fun `download updates SyncMetadata after writing`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_meta_test"
            val files = makeBundle(packId)
            val backendHash = "deadeef123"
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to backendHash)))
                    .setHeader("Content-Type", "application/json")
            )

            val packsDir = Files.createTempDirectory("ifz_meta_").toFile()
            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url       = server.url("/api/bundles/$packId").toString(),
                serverKey = "sk_test",
                packId    = packId,
            )

            val meta = SyncMetadata.read(File(packsDir, packId))
            val diskHash = BundleHasher.hash(File(packsDir, packId))
            assertEquals(diskHash, meta.syncedHash)
            assertEquals(backendHash, meta.backendHash)
        }
    }

    @Test
    fun `download removes local files not present in bundle`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_sweep_test"
            val packsDir = Files.createTempDirectory("ifz_sweep_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }

            // Seed: deux menus sur disque
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/keep.yaml").writeText("id: keep\nsize: 27\n")
            File(packDir, "menus/stale.yaml").writeText("id: stale\nsize: 9\n")

            // Bundle backend : seulement keep.yaml (stale.yaml a été supprimé dans l'éditeur)
            val files = mapOf(
                "plugins/Interfaze/packs/$packId/menus/keep.yaml" to "id: keep\nsize: 27\n"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "abc")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url = server.url("/api/bundles/$packId").toString(),
                serverKey = "sk", packId = packId,
            )

            assertTrue(File(packDir, "menus/keep.yaml").exists(), "keep.yaml doit être conservé")
            assertTrue(!File(packDir, "menus/stale.yaml").exists(), "stale.yaml doit être supprimé")
        }
    }
}
