package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * `project_read` serves the **snapshot**: the raw bytes the plugin read at the last
 * load, not the current disk state.
 *
 * These are reload semantics, as in every other Minecraft plugin: a hand edit applies
 * nowhere before `/artisan reload`. The editor therefore shows what is actually
 * running instead of a disk the server has not read yet.
 *
 * The snapshot is made of **raw bytes**, not the parsed model: that is what the
 * compare-and-swap compares. A re-serialized model would give other bytes, hence wrong
 * `base_hash` values: conflicts everywhere, or silent overwrites. A free consequence:
 * an unreadable file is in it too, so it stays repairable from the editor.
 */
class SnapshotReadTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_snap_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        var latch = CountDownLatch(1)
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(root),
            logger = null,
        )
        init {
            provider.setSendForTesting { raw ->
                @Suppress("UNCHECKED_CAST")
                sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
                latch.countDown()
            }
        }
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(projectId: String): Map<String, String> {
            latch = CountDownLatch(1)
            sink.clear()
            provider.handleMessageForTesting(
                """{"type":"project_read","request_id":"r","project_id":"$projectId"}"""
            )
            assertTrue(latch.await(5, TimeUnit.SECONDS), "no reply within 5s")
            @Suppress("UNCHECKED_CAST")
            val files = sink.single { it["type"] != "projects_reloaded" }["files"] as List<Map<String, String>>
            return files.associate { it["path"]!! to it["content"]!! }
        }
    }

    @Test
    fun `a disk edit does not show before a reload`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        assertEquals("schema: menu/v1\nsize: 27\n", h.read("boutique")["menus/m.yaml"])

        // Someone edits the file by hand while the server is running.
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 54\n")

        // The server has not re-read it: the editor sees what runs, not the disk.
        assertEquals("schema: menu/v1\nsize: 27\n", h.read("boutique")["menus/m.yaml"])

        h.provider.load()
        assertEquals("schema: menu/v1\nsize: 54\n", h.read("boutique")["menus/m.yaml"])
    }

    @Test
    fun `a root an add-on registers after loading becomes readable`() {
        val h = Harness()
        h.provider.load()

        // An Add-on enables AFTER the core (9 s later in real conditions) and only then
        // registers its root (ADR `addon-owned-project-roots`). The snapshot taken when
        // Artisan loaded cannot contain it: without a refresh, its Project answers
        // `unknown_project` forever.
        val addonRoot = File(h.root, "../boutique_editor").also { it.mkdirs() }
        File(addonRoot, "menus/m.yaml").also { it.parentFile.mkdirs() }
            .writeText("schema: menu/v1\nsize: 27\n")
        h.provider.registerProjectRoot("boutique_shop", addonRoot)

        assertEquals("schema: menu/v1\nsize: 27\n", h.read("boutique_shop")["menus/m.yaml"])
    }

    @Test
    fun `an add-on that writes its own files can refresh the snapshot`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        // An Add-on writes into ITS root: `/boutiqueadmin additem` captures an item and
        // adds it to the catalogue (ADR `addon-owned-project-roots`). Without an
        // announcement, that write stays invisible to the running server AND the editor
        // until SOMEONE types `/artisan reload`: the admin captures an item, sees it
        // nowhere, and thinks the command is broken.
        h.write(p, "items/ci_abc.yml", "type: DIAMOND_SWORD\n")
        assertNull(h.read("boutique")["items/ci_abc.yml"])

        // The module declares it and the snapshot picks it up: the same path as
        // `/artisan reload`, triggered by the one who knows it wrote.
        h.provider.refreshFromDisk()
        assertEquals("type: DIAMOND_SWORD\n", h.read("boutique")["items/ci_abc.yml"])
    }

    @Test
    fun `the snapshot keeps the exact bytes, comments included`() {
        val h = Harness()
        val p = h.project("boutique")
        val exact = "# portage zMenu\nschema: menu/v1\n\nsize:   27\n"
        h.write(p, "menus/m.yaml", exact)
        h.provider.load()

        // Exact bytes: that is what the compare-and-swap compares.
        assertEquals(exact, h.read("boutique")["menus/m.yaml"])
    }

    @Test
    fun `an unparseable file is in the snapshot and stays repairable`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/ok.yaml", "schema: menu/v1\nsize: 27\n")
        h.write(p, "menus/casse.yaml", "schema: menu/v1\n  : : indentation cassée\n")
        h.provider.load()

        val files = h.read("boutique")
        // The plugin skipped it when parsing, but the editor must be able to open it
        // to fix it: otherwise the typo locks you out.
        assertTrue(files.containsKey("menus/casse.yaml"))
        assertTrue(files.containsKey("menus/ok.yaml"))
    }
}
