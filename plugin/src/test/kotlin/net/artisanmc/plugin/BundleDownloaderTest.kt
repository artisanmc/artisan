package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.sync.BundleDownloader
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.SyncMetadata
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
        "plugins/Artisan/projects/$packId/manifest.yaml" to "schema: manifest/v1\nproject_id: $packId\n",
        "plugins/Artisan/projects/$packId/menus/shop.yaml" to "id: shop\nsize: 27\n",
    )

    @Test
    fun `download writes YAML files to pack dir under packsDir`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_dl_test"
            val files = makeBundle(packId)
            val responseBody = mapper.writeValueAsString(mapOf("files" to files, "hash" to "abc123"))
            server.enqueue(MockResponse().setBody(responseBody).setHeader("Content-Type", "application/json"))

            val packsDir = Files.createTempDirectory("artisan_dl_").toFile()
            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url       = server.url("/api/v1/bundles/$packId").toString(),
                serverKey = "sk_test",
                projectId = packId,
            )

            assertTrue(File(packsDir, "$packId/manifest.yaml").exists())
            assertTrue(File(packsDir, "$packId/menus/shop.yaml").exists())
            assertEquals("schema: manifest/v1\nproject_id: $packId\n",
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

            val packsDir = Files.createTempDirectory("artisan_meta_").toFile()
            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url       = server.url("/api/v1/bundles/$packId").toString(),
                serverKey = "sk_test",
                projectId = packId,
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
            val packsDir = Files.createTempDirectory("artisan_sweep_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }

            // Seed: deux menus sur disque
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/keep.yaml").writeText("id: keep\nsize: 27\n")
            File(packDir, "menus/stale.yaml").writeText("id: stale\nsize: 9\n")

            // Bundle backend : seulement keep.yaml (stale.yaml a été supprimé dans l'éditeur)
            val files = mapOf(
                "plugins/Artisan/projects/$packId/menus/keep.yaml" to "id: keep\nsize: 27\n"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "abc")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url = server.url("/api/v1/bundles/$packId").toString(),
                serverKey = "sk", projectId = packId,
            )

            assertTrue(File(packDir, "menus/keep.yaml").exists(), "keep.yaml doit être conservé")
            assertTrue(!File(packDir, "menus/stale.yaml").exists(), "stale.yaml doit être supprimé")
        }
    }

    @Test
    fun `sweep preserves dotartisan metadata files`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_meta_preserve"
            val packsDir = Files.createTempDirectory("artisan_meta_preserve_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }
            File(packDir, ".artisan-sync.yaml").writeText("syncedHash: prev\nbackendHash: prev\n")
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/old.yaml").writeText("id: old\n")

            // Bundle vide (admin a tout supprimé)
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to emptyMap<String, String>(), "hash" to "")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(server.url("/api/v1/bundles/$packId").toString(), "sk", packId)

            assertTrue(File(packDir, ".artisan-sync.yaml").exists(), "métadonnée préservée")
            assertTrue(!File(packDir, "menus/old.yaml").exists(), "fichier sweepé")
        }
    }

    @Test
    fun `sweep removes directories that become empty`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_dir_cleanup"
            val packsDir = Files.createTempDirectory("artisan_dir_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }
            File(packDir, "dialogs").mkdirs()
            File(packDir, "dialogs/d1.yaml").writeText("id: d1\n")
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/m1.yaml").writeText("id: m1\n")

            // Bundle ne garde que menus/m1.yaml — dialogs/ doit disparaitre
            val files = mapOf(
                "plugins/Artisan/projects/$packId/menus/m1.yaml" to "id: m1\n"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "x")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(server.url("/api/v1/bundles/$packId").toString(), "sk", packId)

            assertTrue(!File(packDir, "dialogs").exists(), "dialogs/ doit être supprimé (vide après sweep)")
            assertTrue(File(packDir, "menus/m1.yaml").exists(), "menus/m1.yaml conservé")
            assertTrue(File(packDir, "menus").exists(), "menus/ conservé (contient m1)")
        }
    }

    @Test
    fun `download rejects path traversal in file keys`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_traversal"
            val packsDir = Files.createTempDirectory("artisan_trav_").toFile()
            // Fichier hors du packDir — ne doit JAMAIS être écrit
            val outsideTarget = File(packsDir, "outside.txt")

            val files = mapOf(
                "plugins/Artisan/projects/$packId/../outside.txt" to "pwned"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "h")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(server.url("/api/v1/bundles/$packId").toString(), "sk", packId)

            assertTrue(!outsideTarget.exists(), "Le fichier en dehors du packDir doit être bloqué")
        }
    }

    @Test
    fun `unchanged files are not rewritten and no tmp files linger (atomic writes)`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_atomic"
            val files = makeBundle(packId)
            val body = mapper.writeValueAsString(mapOf("files" to files, "hash" to "h1"))
            server.enqueue(MockResponse().setBody(body).setHeader("Content-Type", "application/json"))
            server.enqueue(MockResponse().setBody(body).setHeader("Content-Type", "application/json"))

            val packsDir = Files.createTempDirectory("artisan_atomic_").toFile()
            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            val url = server.url("/api/v1/bundles/$packId").toString()
            downloader.download(url = url, serverKey = "sk", projectId = packId)

            val manifest = File(packsDir, "$packId/manifest.yaml")
            val stampBefore = manifest.lastModified()
            Thread.sleep(50)
            // Second download of identical content: files must be left untouched
            // (an echo of our own local_push must not churn the disk/watcher).
            downloader.download(url = url, serverKey = "sk", projectId = packId)
            assertEquals(stampBefore, manifest.lastModified(), "identical content must not be rewritten")

            val tmps = File(packsDir, packId).walkTopDown().filter { it.name.endsWith(".artisan-tmp") }.toList()
            assertEquals(emptyList(), tmps, "no .artisan-tmp staging files may remain after a download")
        }
    }
}
