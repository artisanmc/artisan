package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.sync.ProjectFilesReader
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.IOException
import java.nio.file.Files

class ProjectPublisherRecoveryTest {
    @TempDir lateinit var root: File
    private val mapper = ObjectMapper()

    @Test fun `completed receipts leave recovery queue and remain retryable after restart`() {
        val result = mapper.readTree("{\"ok\":true}")
        ProjectPublisher(root).commit("op", "request", mapOf("a.yaml" to "first".toByteArray()), result)
        val transactions = File(root, ".artisan/transactions")
        assertEquals(listOf(".receipts"), transactions.list()!!.toList())
        File(root, "a.yaml").writeText("later")
        ProjectPublisher(root).recover()
        assertEquals(result, ProjectPublisher(root).previous("op", "request"))
        assertEquals("later", File(root, "a.yaml").readText())
        assertThrows(IllegalArgumentException::class.java) { ProjectPublisher(root).previous("op", "other") }
    }

    @Test fun `legacy completed journals are archived once without replaying old edits`() {
        ProjectPublisher(root).commit("op", "request", mapOf("a.yaml" to "first".toByteArray()), mapper.readTree("{}"))
        val transactions = File(root, ".artisan/transactions")
        val archived = File(transactions, ".receipts").listFiles()?.single()
        if (archived != null) Files.move(archived.toPath(), File(transactions, archived.name).toPath())
        File(root, "a.yaml").writeText("later")
        ProjectPublisher(root).recover()
        assertEquals("later", File(root, "a.yaml").readText())
        assertEquals(listOf(".receipts"), transactions.list()!!.toList())
        assertNotNull(ProjectPublisher(root).previous("op", "request"))
    }

    @Test fun `recovery does not open archived receipts unrelated to the pending operation`() {
        ProjectPublisher(root).commit("old", "old", emptyMap(), mapper.readTree("{}"))
        val receipt = File(root, ".artisan/transactions/.receipts").walkTopDown().firstOrNull { it.name == "intent.json" }
        assertNotNull(receipt)
        receipt!!.writeText("unreadable historical receipt")
        assertThrows(IOException::class.java) {
            ProjectPublisher(root) { throw IOException("crash") }.commit("new", "new", mapOf("a.yaml" to "new".toByteArray()), mapper.readTree("{}"))
        }
        ProjectPublisher(root).recover()
        assertEquals("new", File(root, "a.yaml").readText())
        assertNotNull(ProjectPublisher(root).previous("new", "new"))
    }

    @Test fun `impossible file hierarchies are rejected before accepting any journal`() {
        val scenarios = listOf(
            linkedMapOf("x" to "a".toByteArray(), "x/y" to "b".toByteArray()),
            linkedMapOf("x/y" to "b".toByteArray(), "x" to "a".toByteArray()),
        )
        scenarios.forEachIndexed { index, changes ->
            val project = File(root, "overlap$index").also { it.mkdirs() }
            assertThrows(IllegalArgumentException::class.java) {
                ProjectPublisher(project).commit("invalid", "request", changes, mapper.readTree("{}"))
            }
            assertFalse(File(project, ".artisan/transactions").exists())
            assertFalse(File(project, "x").exists())
            ProjectPublisher(project).recover()
        }
    }

    @Test fun `existing file ancestors and nonempty directory targets cannot poison recovery`() {
        File(root, "x").writeText("original")
        File(root, "dir/child").also { it.parentFile.mkdirs(); it.writeText("keep") }
        for (changes in listOf(mapOf("x/y" to byteArrayOf(1)), mapOf("dir" to byteArrayOf(2)), mapOf<String, ByteArray?>("dir" to null))) {
            assertThrows(IllegalArgumentException::class.java) {
                ProjectPublisher(root).commit("invalid", "request", changes, mapper.readTree("{}"))
            }
            assertFalse(File(root, ".artisan/transactions").exists())
        }
        assertEquals("original", File(root, "x").readText())
        assertEquals("keep", File(root, "dir/child").readText())
    }

    @Test fun `Windows aliases reject duplicate writes but preserve case-only rename`() {
        org.junit.jupiter.api.Assumptions.assumeTrue(File.separatorChar == '\\')
        for (changes in listOf(linkedMapOf("a" to byteArrayOf(1), "A" to byteArrayOf(2)), linkedMapOf("x" to byteArrayOf(1), "X/y" to byteArrayOf(2)))) {
            assertThrows(IllegalArgumentException::class.java) {
                ProjectPublisher(root).commit("bad", "request", changes, mapper.readTree("{}"))
            }
            assertFalse(File(root, ".artisan/transactions").exists())
        }
        File(root, "name.yaml").writeText("old")
        ProjectPublisher(root).commit("rename", "request", linkedMapOf("name.yaml" to null, "NAME.yaml" to "new".toByteArray()), mapper.readTree("{}"))
        assertEquals("new", File(root, "NAME.yaml").readText())
        assertTrue(root.list()!!.contains("NAME.yaml"))
    }

    @Test fun `accepted publication recovers all files and terminal state before root discovery at every interruption`() {
        for (interruptAt in 0..2) {
            val core = File(root, "run$interruptAt").also { it.mkdirs() }
            val project = File(core, "shop").also { it.mkdirs() }
            val changes = linkedMapOf("menus/a.yaml" to "new a".toByteArray(), "assets/a.png" to byteArrayOf(-1, 0, 1), ".artisan/drafts/d1/draft.json" to "published".toByteArray())
            assertThrows(IOException::class.java) {
                ProjectPublisher(project) { if (it == interruptAt) throw IOException("crash") }.commit("op", "request", changes, mapper.readTree("{\"ok\":true}"))
            }
            val discovered = ProjectRoots(core).all()
            assertEquals(setOf("shop"), discovered.keys)
            changes.forEach { (path, bytes) -> assertArrayEquals(bytes, File(project, path).readBytes()) }
            assertEquals(setOf("menus/a.yaml"), ProjectFilesReader.readAll(project).keys)
            assertTrue(ProjectPublisher(project).previous("op", "request")!!["ok"].asBoolean())
        }
    }
    @Test fun `recovery failure isolates affected root while healthy roots remain readable`() {
        val broken = File(root, "broken").also { it.mkdirs() }
        File(root, "healthy").mkdirs()
        assertThrows(IOException::class.java) {
            ProjectPublisher(broken) { throw IOException("crash") }.commit("op", "request", mapOf("a.yaml" to "a".toByteArray(), "b.yaml" to "b".toByteArray()), mapper.readTree("{}"))
        }
        File(broken, ".artisan/transactions").walkTopDown().first { it.name == "1.blob" }.delete()
        assertEquals(setOf("healthy"), ProjectRoots(root).all().keys)
    }
    @Test fun `late addon registration replays its publication before discovery`() {
        val roots = ProjectRoots(File(root, "core").also { it.mkdirs() })
        val addon = File(root, "addon/content").also { it.mkdirs() }
        assertThrows(IOException::class.java) {
            ProjectPublisher(addon) { throw IOException("crash") }.commit("op", "request", mapOf("a.yaml" to "a".toByteArray(), "b.yaml" to "b".toByteArray()), mapper.readTree("{}"))
        }
        roots.register("addon_id", addon)
        assertEquals(addon, roots.all()["addon_id"])
        assertEquals("b", File(addon, "b.yaml").readText())
    }
    @Test fun `binary write keeps no disk history and duplicate retry does not overwrite newer changes`() {
        val before = byteArrayOf(-119, 0, -1)
        File(root, "image.png").writeBytes(before)
        val publisher = ProjectPublisher(root)
        publisher.commit("op", "request", publisher.withHistory(mapOf("image.png" to byteArrayOf(1, 2))), mapper.readTree("{\"ok\":true}"))
        assertFalse(File(root, ".artisan/history").exists())
        assertTrue(ProjectFilesReader.readAll(root).isEmpty())
        assertEquals(listOf("image.png"), ProjectFilesReader.allPaths(root))
        File(root, "image.png").writeBytes(byteArrayOf(3))
        publisher.commit("op", "request", mapOf("image.png" to byteArrayOf(1, 2)), mapper.readTree("{}"))
        assertArrayEquals(byteArrayOf(3), File(root, "image.png").readBytes())
    }
}
