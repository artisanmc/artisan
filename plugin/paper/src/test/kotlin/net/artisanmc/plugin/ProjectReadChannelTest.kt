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
 * `project_read`: the editor reads a Project's full tree from the server's disk (ADR
 * `server-disk-only-storage`). Generalises `config_read`, which only carried one
 * config screen Table.
 *
 * Unlike the disk scan (`ProjectFilesReader.readRelative`), which excludes every
 * `.artisan*`, the editor needs `.artisan/editor.yaml` (board layout, `i18n_mode`).
 * Only the trash and the sync metadata stay out of scope.
 */
class ProjectReadChannelTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_pread_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        val latch = CountDownLatch(1)
        val roots = net.artisanmc.plugin.project.ProjectRoots(root)
        val provider = SyncedMenuProvider(
            roots = roots,
            logger = null,
        )
        init {
            provider.setSendForTesting { raw ->
                @Suppress("UNCHECKED_CAST")
                sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
                latch.countDown()
            }
        }
        /** Waits for THE REPLY: reload announcements travel on the same
         *  connection and may arrive before it. */
        fun await(replies: Int = 1) {
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                if (sink.count { it["type"] != "projects_reloaded" } >= replies) return
                Thread.sleep(10)
            }
            throw AssertionError("expected $replies reply(ies), got ${sink.size} message(s)")
        }
        /** The expected reply, ignoring the reload announcements travelling on
         *  the same connection. */
        fun awaitReply(): Map<String, Any?> {
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                val reply = sink.firstOrNull { it["type"] != "projects_reloaded" }
                if (reply != null) return reply
                Thread.sleep(10)
            }
            throw AssertionError("no reply within 5s")
        }

        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(projectId: String, requestId: String = "r1") {
            // The editor sees what the server LOADED (snapshot), so a load is needed,
            // as for real at startup or on /artisan reload.
            provider.load()
            provider.handleMessageForTesting(
                """{"type":"project_read","request_id":"$requestId","project_id":"$projectId"}"""
            )
            await()
        }
        @Suppress("UNCHECKED_CAST")
        fun files(): List<Map<String, String>> = awaitReply()["files"] as List<Map<String, String>>
    }

    @Test
    fun `project_read returns the full tree, relative paths sorted`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "manifest.yaml", "id: boutique\n")
        h.write(p, "menus/shop_main.yaml", "title: Boutique\n")
        h.write(p, "lang/fr.yaml", "shop:\n  title: Boutique\n")

        h.read("boutique")

        val msg = h.awaitReply()
        assertEquals("project_read_result", msg["type"])
        assertEquals("r1", msg["request_id"])
        assertEquals(true, msg["ok"])
        assertEquals(
            listOf("lang/fr.yaml", "manifest.yaml", "menus/shop_main.yaml"),
            h.files().map { it["path"] },
        )
        assertEquals("title: Boutique\n", h.files().single { it["path"] == "menus/shop_main.yaml" }["content"])
    }

    @Test
    fun `project_read includes editor state but not the trash or sync metadata`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "manifest.yaml", "id: boutique\n")
        h.write(p, ".artisan/editor.yaml", "i18n_mode: inline\n")
        h.write(p, ".artisan/history/menus/shop_main.yaml/1755000000.yaml", "vieille version\n")
        h.write(p, ".artisan-sync.yaml", "synced_hash: abc\n")
        h.write(p, ".artisan-trash/menus/supprime.yaml", "supprimé\n")

        h.read("boutique")

        assertEquals(
            listOf(".artisan/editor.yaml", "manifest.yaml"),
            h.files().map { it["path"] },
        )
    }

    @Test
    fun `project_list returns the loaded projects, sorted`() {
        val h = Harness()
        h.write(h.project("zeta"), "manifest.yaml", "id: zeta\n")
        h.write(h.project("alpha"), "manifest.yaml", "id: alpha\n")

        h.provider.load()
        h.provider.handleMessageForTesting("""{"type":"project_list","request_id":"l1"}""")
        h.await()

        val msg = h.awaitReply()
        assertEquals("project_list_result", msg["type"])
        assertEquals(true, msg["ok"])
        // The folder IS the project: its name is the identity, and the order is
        // deterministic so the sidebar does not shuffle from one tick to the next.
        assertEquals(listOf("alpha", "zeta"), msg["project_ids"])
    }

    @Test
    fun `project_list is empty when the server has no project`() {
        val h = Harness()
        h.provider.load()
        h.provider.handleMessageForTesting("""{"type":"project_list","request_id":"l2"}""")
        h.await()

        assertEquals(true, h.awaitReply()["ok"])
        assertEquals(emptyList<String>(), h.awaitReply()["project_ids"])
    }

    @Test
    fun `project list uses loaded roots without waiting for disk recovery`() {
        val h = Harness()
        h.write(h.project("loaded"), "manifest.yaml", "id: loaded\n")
        h.provider.load()
        h.write(h.project("not_loaded"), "manifest.yaml", "id: not_loaded\n")
        synchronized(h.roots) {
            h.provider.handleMessageForTesting("""{"type":"project_list","request_id":"snapshot"}""")
            val msg = h.awaitReply()
            assertEquals(listOf("loaded"), msg["project_ids"])
            assertEquals(listOf(mapOf("project_id" to "loaded", "identity" to "folder")), msg["project_roots"])
        }
    }

    @Test
    fun `project_read of an unknown project replies unknown_project`() {
        val h = Harness()
        h.read("jamais_cree")

        val msg = h.awaitReply()
        assertEquals(false, msg["ok"])
        assertEquals("unknown_project", msg["error"])
    }

    @Test
    fun `project_read rejects a path traversal`() {
        val h = Harness()
        h.read("../../etc")

        val msg = h.awaitReply()
        assertEquals(false, msg["ok"])
        assertEquals("invalid_path", msg["error"])
    }

    @Test
    fun `project_read rejects a tree over the size cap`() {
        val h = Harness()
        val p = h.project("gros")
        h.write(p, "manifest.yaml", "id: gros\n")
        h.write(p, "lang/en.yaml", "x".repeat(net.artisanmc.plugin.protocol.ProjectReads.MAX_PROJECT_BYTES + 1))

        h.read("gros")

        val msg = h.awaitReply()
        assertEquals(false, msg["ok"])
        assertEquals("too_large", msg["error"])
    }
}
