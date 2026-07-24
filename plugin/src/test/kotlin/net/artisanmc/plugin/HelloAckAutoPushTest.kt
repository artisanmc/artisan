package net.artisanmc.plugin

import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.SyncMetadata
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * ADR files-first-source-of-truth #6 (P3b): a LOCAL_ONLY divergence at
 * hello_ack (disk changed, backend unchanged) is AUTO-PUSHED via local_push —
 * silent + one WARN, no prompts — instead of being overwritten by the next
 * bundle_available. A true CONFLICT (both sides moved) is still only warned
 * about (resolution = P3c).
 */
class HelloAckAutoPushTest {

    private fun writeProject(packsRoot: File, projectId: String): File {
        val dir = File(packsRoot, projectId).apply { mkdirs() }
        File(dir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $projectId\ndefault_lang: en\nfiles:\n  menus: [m]\n  commands: []\n")
        File(dir, "menus").mkdirs()
        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: T\nsize: 27\nelements: []\n")
        return dir
    }

    private fun handleMessage(provider: SyncedMenuProvider, raw: String) {
        val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
        handle.isAccessible = true
        handle.invoke(provider, raw)
    }

    /** Poll the captured sends until one matches, or fail after ~2s (push runs on the http executor). */
    private fun awaitSend(sent: List<String>, predicate: (String) -> Boolean): String {
        val deadline = System.currentTimeMillis() + 2000
        while (System.currentTimeMillis() < deadline) {
            sent.firstOrNull(predicate)?.let { return it }
            Thread.sleep(20)
        }
        fail("expected message not sent within 2s — sent: $sent")
    }

    @Test
    fun `LOCAL_ONLY at hello_ack auto-pushes local content via local_push`() {
        val packsRoot = Files.createTempDirectory("artisan_autopush_").toFile()
        val dir = writeProject(packsRoot, "p_local")
        val diskHash = BundleHasher.hash(dir)
        // Backend still holds the previously-synced state: synced == backend != disk.
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_old")

        val provider = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = "sk", wsUrl = "ws://x", logger = null,
        )
        val sent = CopyOnWriteArrayList<String>()
        provider.setSendForTesting { sent.add(it) }
        // Load without connecting (reflection call keeps the WS out of the picture).
        val reload = provider.javaClass.getDeclaredMethod("reloadFromDisk")
        reload.isAccessible = true
        reload.invoke(provider)

        handleMessage(provider, """{"type":"hello_ack","session_id":"s","project_hashes":{"p_local":"h_old"}}""")

        val push = awaitSend(sent) { it.contains("\"local_push\"") && it.contains("p_local") }
        assertTrue(push.contains(diskHash), "local_push must carry the disk hash")
    }

    @Test
    fun `CONFLICT at hello_ack does NOT auto-push (P3c territory)`() {
        val packsRoot = Files.createTempDirectory("artisan_autopush_").toFile()
        val dir = writeProject(packsRoot, "p_conf")
        // Disk changed AND backend changed since last sync.
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_old")

        val provider = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = "sk", wsUrl = "ws://x", logger = null,
        )
        val sent = CopyOnWriteArrayList<String>()
        provider.setSendForTesting { sent.add(it) }

        handleMessage(provider, """{"type":"hello_ack","session_id":"s","project_hashes":{"p_conf":"h_backend_v2"}}""")

        Thread.sleep(300)
        assertEquals(emptyList(), sent.filter { it.contains("\"local_push\"") }, "conflict must not auto-push")
    }
}
