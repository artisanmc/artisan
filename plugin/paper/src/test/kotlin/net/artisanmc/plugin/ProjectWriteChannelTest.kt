package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.project.ContentHash
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * `project_write`: the editor writes the server's files (ADR `server-disk-only-storage`).
 * The plugin is the only writer, so its guard lives here: a **per-file
 * compare-and-swap**. Each write carries the hash it is based on; if the file moved
 * since, nothing at all is written and the conflicts come back with the disk content
 * (the editor shows the diff without a second round trip).
 *
 * Writes no longer archive the old content; `project_history` only reads versions
 * already present in `.artisan/history/`.
 */
class ProjectWriteChannelTest {
    private val mapper = ObjectMapper()

    private class Harness {
        val root: File = Files.createTempDirectory("artisan_pwrite_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        val latch = CountDownLatch(1)
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
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(project: File, rel: String): String? =
            File(project, rel).takeIf { it.isFile }?.readText()
        fun historyOf(project: File, rel: String): List<String> =
            File(project, ".artisan/history/$rel").listFiles()
                ?.sortedBy { it.name }?.map { it.readText() } ?: emptyList()
        fun send(json: String) {
            provider.handleMessageForTesting(json)
            await()
        }
        fun reply(): Map<String, Any?> = sink.single { it["type"] != "projects_reloaded" }
    }

    private fun writeMsg(projectId: String, files: String, deletes: String = "[]") =
        """{"type":"project_write","request_id":"w1","project_id":"$projectId","files":$files,"deletes":$deletes}"""

    @Test
    fun `mixed lot checks binary CAS before writing descriptor and retries after lost reply`() {
        val h = Harness()
        val p = h.project("shop")
        val message = """{"type":"project_write","request_id":"w1","operation_id":"mixed1","project_id":"shop","files":[{"path":"assets/glyphs/a.yaml","content":"height: 8"}],"binaries":[{"path":"assets/glyphs/a.png","content_base64":"AAEC/w==","base_hash":null}]}"""
        h.write(p, "assets/glyphs/a.png", "external")
        h.send(message)
        assertEquals("conflict", h.reply()["error"])
        assertFalse(File(p, "assets/glyphs/a.yaml").exists())
        File(p, "assets/glyphs/a.png").delete()
        h.sink.clear()
        h.send(message)
        assertEquals(true, h.reply()["ok"])
        assertArrayEquals(byteArrayOf(0, 1, 2, -1), File(p, "assets/glyphs/a.png").readBytes())
        h.write(p, "assets/glyphs/a.png", "later")
        h.sink.clear()
        h.send(message.replace("w1", "w2"))
        assertEquals(true, h.reply()["ok"])
        assertEquals("later", h.read(p, "assets/glyphs/a.png"))
    }

    @Test
    fun `mixed lot rejects duplicate text binary target and private binaries`() {
        for (path in listOf("a.yaml", ".artisan/drafts/x/blob")) {
            val h = Harness()
            val p = h.project("shop")
            h.send("""{"type":"project_write","request_id":"w1","operation_id":"mixed2","project_id":"shop","files":[{"path":"a.yaml","content":"x"}],"binaries":[{"path":"$path","content_base64":"AA==","base_hash":null}]}""")
            assertEquals("invalid_path", h.reply()["error"])
            assertFalse(File(p, "a.yaml").exists())
        }
    }

    @Test
    fun `private draft and journal paths are rejected through all generic channels`() {
        val h = Harness()
        h.project("shop")
        for (path in listOf(".artisan/drafts/d1/draft.json", ".artisan/transactions/op/intent.json", ".ARTISAN/DRAFTS/d1/draft.json", ".artisan/rename-operation.json")) {
            for (message in listOf(
                mapOf("type" to "project_write", "files" to listOf(mapOf("path" to path, "content" to "private"))),
                mapOf("type" to "project_history", "path" to path),
                mapOf("type" to "config_read", "table" to path),
                mapOf("type" to "config_write", "files" to listOf(mapOf("path" to path, "content" to "private"))),
                mapOf("type" to "asset_read", "path" to path),
            )) {
                h.sink.clear()
                h.send(mapper.writeValueAsString(message + mapOf("request_id" to "r", "project_id" to "shop")))
                assertEquals("invalid_path", h.reply()["error"], message.toString())
            }
        }
    }

    @Test
    fun `operation retry acknowledges publication without overwriting subsequent disk edits`() {
        val h = Harness()
        val project = h.project("shop")
        val message = """{"type":"project_write","request_id":"w1","operation_id":"publish-op","project_id":"shop","files":[{"path":"a.yaml","content":"published"}]}"""
        h.send(message)
        assertEquals(true, h.reply()["ok"])
        h.write(project, "a.yaml", "external edit")
        h.sink.clear()
        h.send(message.replace("w1", "w2"))
        assertEquals(true, h.reply()["ok"])
        assertEquals("external edit", h.read(project, "a.yaml"))
    }

    @Test
    fun `writes the files and acknowledges`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "manifest.yaml", "id: boutique\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/shop_main.yaml","content":"schema: menu/v1\ntitle: Boutique\nsize: 27\nelements: []\n","base_hash":null}
        ]"""))

        assertEquals("project_write_result", h.reply()["type"])
        assertEquals(true, h.reply()["ok"], h.reply().toString())
        assertEquals("schema: menu/v1\ntitle: Boutique\nsize: 27\nelements: []\n", h.read(p, "menus/shop_main.yaml"))
    }

    @Test
    fun `does not archive the previous content`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/shop_main.yaml", "title: Ancien\n")
        val base = ContentHash.hashContent("title: Ancien\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/shop_main.yaml","content":"schema: menu/v1\ntitle: Nouveau\nsize: 27\nelements: []\n","base_hash":"$base"}
        ]"""))

        assertEquals(true, h.reply()["ok"], h.reply().toString())
        assertEquals("schema: menu/v1\ntitle: Nouveau\nsize: 27\nelements: []\n", h.read(p, "menus/shop_main.yaml"))
        assertEquals(emptyList<String>(), h.historyOf(p, "menus/shop_main.yaml"))
    }

    @Test
    fun `rejects the whole batch if one base_hash moved, and returns the disk content`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/a.yaml", "title: A disque\n")
        h.write(p, "menus/b.yaml", "title: B\n")
        val staleHash = ContentHash.hashContent("title: A que l'editeur croyait\n")
        val freshHash = ContentHash.hashContent("title: B\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/a.yaml","content":"title: A edite\n","base_hash":"$staleHash"},
            {"path":"menus/b.yaml","content":"title: B edite\n","base_hash":"$freshHash"}
        ]"""))

        val msg = h.reply()
        assertEquals(false, msg["ok"])
        assertEquals("conflict", msg["error"])
        @Suppress("UNCHECKED_CAST")
        val conflicts = msg["conflicts"] as List<Map<String, String?>>
        assertEquals(listOf("menus/a.yaml"), conflicts.map { it["path"] })
        assertEquals("title: A disque\n", conflicts[0]["disk"])

        // All or nothing: b.yaml, although not in conflict, did not move either.
        assertEquals("title: A disque\n", h.read(p, "menus/a.yaml"))
        assertEquals("title: B\n", h.read(p, "menus/b.yaml"))
        assertTrue(h.historyOf(p, "menus/a.yaml").isEmpty(), "nothing must be archived on a refusal")
    }

    @Test
    fun `a conflict returns the actual folder listing, so a rename shows`() {
        val h = Harness()
        val p = h.project("boutique")
        // Someone renamed a.yaml to renomme.yaml on disk. For the CAS that is a
        // deletion, and without the list below "keep my version" would recreate
        // a.yaml and leave renomme.yaml: two files for one menu, with nothing to say so.
        h.write(p, "menus/renomme.yaml", "title: A\n")
        val base = ContentHash.hashContent("title: A\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/a.yaml","content":"title: A edite\n","base_hash":"$base"}
        ]"""))

        val msg = h.reply()
        assertEquals("conflict", msg["error"])
        @Suppress("UNCHECKED_CAST")
        val onDisk = msg["disk_files"] as List<String>
        assertTrue(onDisk.contains("menus/renomme.yaml"), "the file that appeared must be visible: $onDisk")
        assertFalse(onDisk.contains("menus/a.yaml"))
    }

    @Test
    fun `a null base_hash means a new file, and conflicts if it already exists`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/deja.yaml", "title: Existant\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/deja.yaml","content":"title: Neuf\n","base_hash":null}
        ]"""))

        val msg = h.reply()
        assertEquals(false, msg["ok"])
        assertEquals("conflict", msg["error"])
        @Suppress("UNCHECKED_CAST")
        val conflicts = msg["conflicts"] as List<Map<String, String?>>
        assertEquals("title: Existant\n", conflicts.single()["disk"])
        assertEquals("title: Existant\n", h.read(p, "menus/deja.yaml"))
    }

    @Test
    fun `deletes a file under CAS without archiving it`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/vieux.yaml", "title: Vieux\n")
        val base = ContentHash.hashContent("title: Vieux\n")

        h.send(writeMsg("boutique", "[]", """[{"path":"menus/vieux.yaml","base_hash":"$base"}]"""))

        assertEquals(true, h.reply()["ok"])
        assertNull(h.read(p, "menus/vieux.yaml"))
        assertEquals(emptyList<String>(), h.historyOf(p, "menus/vieux.yaml"))
    }

    @Test
    fun `the editor may write its own state but not other metadata`() {
        val h = Harness()
        val p = h.project("boutique")

        h.send(writeMsg("boutique", """[
            {"path":".artisan/editor.yaml","content":"i18n_mode: inline\n","base_hash":null}
        ]"""))
        assertEquals(true, h.reply()["ok"])
        assertEquals("i18n_mode: inline\n", h.read(p, ".artisan/editor.yaml"))

        val h2 = Harness()
        h2.project("boutique")
        h2.send(writeMsg("boutique", """[
            {"path":".artisan/history/menus/m.yaml/1","content":"forge\n","base_hash":null}
        ]"""))
        assertEquals(false, h2.reply()["ok"])
        assertEquals("invalid_path", h2.reply()["error"])
    }

    @Test
    fun `creates the project folder when the caller explicitly asks`() {
        val h = Harness()
        // No `project()`: the folder does not exist yet, as after a creation or an
        // import in the editor.
        h.provider.handleMessageForTesting(
            """{"type":"project_write","request_id":"w1","project_id":"tout_neuf","create":true,"files":[
                {"path":"manifest.yaml","content":"id: tout_neuf\n","base_hash":null}
            ],"deletes":[]}"""
        )
        h.await()

        assertEquals(true, h.reply()["ok"])
        assertEquals("id: tout_neuf\n", h.read(File(h.root, "tout_neuf"), "manifest.yaml"))
    }

    @Test
    fun `project_history returns archived versions, most recent first`() {
        val h = Harness()
        val p = h.project("boutique")
        val hist = File(p, ".artisan/history/menus/m.yaml").also { it.mkdirs() }
        File(hist, "1755000000000").writeText("v1")
        File(hist, "1755000009999").writeText("v2")

        h.provider.handleMessageForTesting(
            """{"type":"project_history","request_id":"h1","project_id":"boutique","path":"menus/m.yaml"}"""
        )
        h.await()

        val msg = h.reply()
        assertEquals("project_history_result", msg["type"])
        assertEquals(true, msg["ok"])
        @Suppress("UNCHECKED_CAST")
        val versions = msg["versions"] as List<Map<String, Any?>>
        // Most recent first: the one you want to restore nine times out of ten.
        assertEquals(listOf("v2", "v1"), versions.map { it["content"] })
        assertEquals(1755000009999L, (versions[0]["at"] as Number).toLong())
    }

    @Test
    fun `project_history of a file without archives is an empty list`() {
        val h = Harness()
        h.project("boutique")
        h.provider.handleMessageForTesting(
            """{"type":"project_history","request_id":"h2","project_id":"boutique","path":"menus/jamais.yaml"}"""
        )
        h.await()

        assertEquals(true, h.reply()["ok"])
        @Suppress("UNCHECKED_CAST")
        assertTrue((h.reply()["versions"] as List<Map<String, Any?>>).isEmpty())
    }

    @Test
    fun `project_history refuses to read outside the project tree`() {
        val h = Harness()
        h.project("boutique")
        h.provider.handleMessageForTesting(
            """{"type":"project_history","request_id":"h3","project_id":"boutique","path":"../../secrets"}"""
        )
        h.await()

        assertEquals(false, h.reply()["ok"])
        assertEquals("invalid_path", h.reply()["error"])
    }

    @Test
    fun `rejects a path traversal and an unknown project`() {
        val h = Harness()
        h.project("boutique")
        h.send(writeMsg("boutique", """[
            {"path":"../../evade.yaml","content":"x\n","base_hash":null}
        ]"""))
        assertEquals("invalid_path", h.reply()["error"])

        val h2 = Harness()
        h2.send(writeMsg("jamais_cree", """[
            {"path":"menus/m.yaml","content":"x\n","base_hash":null}
        ]"""))
        assertEquals("unknown_project", h2.reply()["error"])
    }
}
