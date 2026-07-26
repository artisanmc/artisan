package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.SyncMetadata
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * ADR files-first-source-of-truth #6: `bundle_available` must never overwrite
 * local-only disk changes. The handler runs the same detectSyncAction gate as
 * hello_ack — LOCAL_ONLY auto-pushes instead of downloading, CONFLICT reports
 * sync_divergence — unless the backend marks the bundle `force: true`
 * (divergence resolution / manual pushLocal echo), which downloads
 * unconditionally. Regression: a project migrated on disk at boot was swept
 * back by the connect-time bundle_available (2026-07-26).
 */
class BundleAvailableGuardTest {

    private val mapper = ObjectMapper()

    private fun writeProject(packsRoot: File, projectId: String): File {
        val dir = File(packsRoot, projectId).apply { mkdirs() }
        File(dir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $projectId\n")
        File(dir, "menus").mkdirs()
        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: T\nsize: 27\nelements: []\n")
        return dir
    }

    private fun provider(packsRoot: File): Pair<SyncedMenuProvider, CopyOnWriteArrayList<String>> {
        val p = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = "sk", wsUrl = "ws://x", logger = null,
        )
        val sent = CopyOnWriteArrayList<String>()
        p.setSendForTesting { sent.add(it) }
        return p to sent
    }

    private fun handleMessage(provider: SyncedMenuProvider, raw: String) {
        val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
        handle.isAccessible = true
        handle.invoke(provider, raw)
    }

    private fun awaitSend(sent: List<String>, predicate: (String) -> Boolean): String {
        val deadline = System.currentTimeMillis() + 2000
        while (System.currentTimeMillis() < deadline) {
            sent.firstOrNull(predicate)?.let { return it }
            Thread.sleep(20)
        }
        fail("expected message not sent within 2s — sent: $sent")
    }

    @Test
    fun `LOCAL_ONLY bundle_available does not download — auto-pushes instead`() {
        val packsRoot = Files.createTempDirectory("artisan_bag_").toFile()
        val dir = writeProject(packsRoot, "p_lo")
        val diskHash = BundleHasher.hash(dir)
        // Disk changed since last sync; the announced bundle IS the synced state.
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_old")

        val (p, sent) = provider(packsRoot)
        handleMessage(p, """{"type":"bundle_available","project_id":"p_lo","url":"http://127.0.0.1:9/x","hash":"h_old","signature":""}""")

        val push = awaitSend(sent) { it.contains("\"local_push\"") && it.contains("p_lo") }
        assertTrue(push.contains(diskHash), "local_push must carry the disk hash")
        assertEquals("schema: manifest/v1\nproject_id: p_lo\n", File(dir, "manifest.yaml").readText(),
            "disk must be untouched")
    }

    @Test
    fun `CONFLICT bundle_available does not download — reports sync_divergence`() {
        val packsRoot = Files.createTempDirectory("artisan_bag_").toFile()
        val dir = writeProject(packsRoot, "p_cf")
        val diskHash = BundleHasher.hash(dir)
        // Disk changed AND the announced bundle is new: both sides moved.
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_old")

        val (p, sent) = provider(packsRoot)
        handleMessage(p, """{"type":"bundle_available","project_id":"p_cf","url":"http://127.0.0.1:9/x","hash":"h_new","signature":""}""")

        val div = awaitSend(sent) { it.contains("\"sync_divergence\"") && it.contains("p_cf") }
        assertTrue(div.contains(diskHash), "sync_divergence must carry the disk hash")
        assertEquals(emptyList(), sent.filter { it.contains("\"local_push\"") }, "conflict must not push")
        assertEquals("schema: manifest/v1\nproject_id: p_cf\n", File(dir, "manifest.yaml").readText(),
            "disk must be untouched")
    }

    @Test
    fun `force bundle_available downloads even over local changes (divergence resolution)`() {
        val packsRoot = Files.createTempDirectory("artisan_bag_").toFile()
        val dir = writeProject(packsRoot, "p_force")
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_old")

        val merged = mapOf(
            "plugins/Artisan/projects/p_force/manifest.yaml" to "schema: manifest/v1\nproject_id: p_force\n# merged\n",
        )
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to merged, "hash" to "h_merged")))
                    .setHeader("Content-Type", "application/json")
            )
            server.start()

            val (p, _) = provider(packsRoot)
            val url = server.url("/api/v1/bundles/p_force").toString()
            handleMessage(p, """{"type":"bundle_available","project_id":"p_force","url":"$url","hash":"h_merged","signature":"","force":true}""")

            val deadline = System.currentTimeMillis() + 5000
            val manifest = File(dir, "manifest.yaml")
            while (!manifest.readText().contains("# merged") && System.currentTimeMillis() < deadline) Thread.sleep(50)
            assertTrue(manifest.readText().contains("# merged"), "force must download over local changes")
        }
    }
}
