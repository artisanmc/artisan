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
    fun `CONFLICT at hello_ack does NOT auto-push but reports sync_divergence`() {
        val packsRoot = Files.createTempDirectory("artisan_autopush_").toFile()
        val dir = writeProject(packsRoot, "p_conf")
        val diskHash = BundleHasher.hash(dir)
        // Disk changed AND backend changed since last sync.
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_old")

        val provider = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = "sk", wsUrl = "ws://x", logger = null,
        )
        val sent = CopyOnWriteArrayList<String>()
        provider.setSendForTesting { sent.add(it) }

        handleMessage(provider, """{"type":"hello_ack","session_id":"s","project_hashes":{"p_conf":"h_backend_v2"}}""")

        // P3c: the divergence is REPORTED (with the disk files) so the editor
        // can offer per-file resolution — never pushed, never overwritten.
        val div = awaitSend(sent) { it.contains("\"sync_divergence\"") && it.contains("p_conf") }
        assertTrue(div.contains(diskHash), "sync_divergence must carry the disk hash")
        assertTrue(div.contains("menus/m.yaml"), "sync_divergence must carry the disk files")
        assertEquals(emptyList(), sent.filter { it.contains("\"local_push\"") }, "conflict must not auto-push")
    }

    /**
     * Un module qui écrit des fichiers de project à son activation le fait
     * APRÈS le hello_ack (les modules s'activent après le core) : le contrôle
     * de synchro est déjà passé. Sur un serveur Linux le watcher rattraperait ;
     * sur un bind mount Docker, non — et le fichier finit balayé par le sweep
     * du prochain bundle. `recheckLocalChanges()` rejoue le contrôle une fois
     * les modules chargés.
     */
    @Test
    fun `recheckLocalChanges auto-pushes a file written after hello_ack`() {
        val packsRoot = Files.createTempDirectory("artisan_recheck_").toFile()
        val dir = writeProject(packsRoot, "p_mod")
        SyncMetadata.recordSync(dir, syncedHash = BundleHasher.hash(dir), backendHash = BundleHasher.hash(dir))

        val provider = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = "sk", wsUrl = "ws://x", logger = null,
        )
        val sent = CopyOnWriteArrayList<String>()
        provider.setSendForTesting { sent.add(it) }

        // Le backend est d'accord avec le disque : rien à pousser à ce stade.
        handleMessage(
            provider,
            """{"type":"hello_ack","session_id":"s","project_hashes":{"p_mod":"${BundleHasher.hash(dir)}"}}""",
        )
        Thread.sleep(200)
        assertEquals(emptyList(), sent.filter { it.contains("\"local_push\"") }, "rien à pousser au hello_ack")

        // Le module écrit son fichier maintenant.
        File(dir, "models").mkdirs()
        File(dir, "models/shop_settings.yaml").writeText("model: boutique:shop_settings\n")
        val afterWrite = BundleHasher.hash(dir)

        provider.recheckLocalChanges()

        val push = awaitSend(sent) { it.contains("\"local_push\"") && it.contains("p_mod") }
        assertTrue(push.contains(afterWrite), "local_push doit porter le hash du disque APRÈS l'écriture du module")
    }

    /** Sans hello_ack (pas encore connecté), il n'y a rien à comparer : no-op. */
    @Test
    fun `recheckLocalChanges is a no-op before any hello_ack`() {
        val packsRoot = Files.createTempDirectory("artisan_recheck_").toFile()
        writeProject(packsRoot, "p_never")
        val provider = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = "sk", wsUrl = "ws://x", logger = null,
        )
        val sent = CopyOnWriteArrayList<String>()
        provider.setSendForTesting { sent.add(it) }

        provider.recheckLocalChanges()

        Thread.sleep(200)
        assertEquals(emptyList(), sent, "aucun message avant le premier hello_ack")
    }
}
