package net.artisanmc.plugin

import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.SyncMetadata
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Provider-level wiring of the disk watcher (ADR files-first #6): an on-disk
 * edit hot-reloads the in-memory menus AND auto-pushes via local_push when the
 * backend hasn't moved (LOCAL_ONLY); a divergence (CONFLICT) hot-reloads but
 * never pushes.
 */
class WatcherAutoPushIntegrationTest {

    private fun writeProject(packsRoot: File, id: String, title: String): File {
        val dir = File(packsRoot, id).apply { mkdirs() }
        File(dir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $id\ndefault_lang: en\nlanguages: [en]\nfiles:\n  menus: [m]\n  commands: []\n")
        File(dir, "menus").mkdirs()
        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: \"$title\"\nsize: 27\nelements: []\n")
        return dir
    }

    private fun provider(packsRoot: File, serverKey: String): SyncedMenuProvider =
        SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot),
            serverKey = serverKey, wsUrl = "ws://unused", logger = null,
            watchDebounceMs = 200,
        ).also {
            val reload = it.javaClass.getDeclaredMethod("reloadFromDisk")
            reload.isAccessible = true
            reload.invoke(it)
            it.startWatcher()
            Thread.sleep(150)
        }

    private fun await(timeoutMs: Long = 5000, check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (check()) return
            Thread.sleep(25)
        }
        fail("condition not met within ${timeoutMs}ms")
    }

    @Test
    fun `disk edit hot-reloads and auto-pushes when backend unchanged`() {
        val packsRoot = Files.createTempDirectory("artisan_wire_").toFile()
        val dir = writeProject(packsRoot, "p_w", "Old title")
        // Simulate an in-sync history: last sync == current backend state.
        val initialHash = BundleHasher.hash(dir)
        SyncMetadata.recordSync(dir, syncedHash = initialHash, backendHash = initialHash)

        val p = provider(packsRoot, serverKey = "sk")
        val sent = CopyOnWriteArrayList<String>()
        p.setSendForTesting { sent.add(it) }

        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: \"New title\"\nsize: 27\nelements: []\n")

        await { sent.any { it.contains("\"local_push\"") && it.contains("p_w") } }
        await { p.findMenu("m")?.resolveTitle("en")?.contains("New title") == true }
        val newHash = BundleHasher.hash(dir)
        assertTrue(sent.first { it.contains("\"local_push\"") }.contains(newHash))
        p.unload()
    }

    @Test
    fun `disk edit under divergence hot-reloads but does NOT push`() {
        val packsRoot = Files.createTempDirectory("artisan_wire_").toFile()
        val dir = writeProject(packsRoot, "p_div", "Old title")
        // Backend moved since last sync (backendHash != syncedHash).
        SyncMetadata.recordSync(dir, syncedHash = "h_old", backendHash = "h_backend_v2")

        val p = provider(packsRoot, serverKey = "sk")
        val sent = CopyOnWriteArrayList<String>()
        p.setSendForTesting { sent.add(it) }

        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: \"Diverged\"\nsize: 27\nelements: []\n")

        await { p.findMenu("m")?.resolveTitle("en")?.contains("Diverged") == true }
        Thread.sleep(400)
        assertEquals(emptyList(), sent.filter { it.contains("\"local_push\"") })
        p.unload()
    }

    @Test
    fun `offline (empty serverKey) still hot-reloads, never pushes`() {
        val packsRoot = Files.createTempDirectory("artisan_wire_").toFile()
        val dir = writeProject(packsRoot, "p_off", "Old title")

        val p = provider(packsRoot, serverKey = "")
        val sent = CopyOnWriteArrayList<String>()
        p.setSendForTesting { sent.add(it) }

        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: \"Offline edit\"\nsize: 27\nelements: []\n")

        await { p.findMenu("m")?.resolveTitle("en")?.contains("Offline edit") == true }
        assertEquals(emptyList<String>(), sent)
        assertNotNull(p.findMenu("m"))
        p.unload()
    }
}
