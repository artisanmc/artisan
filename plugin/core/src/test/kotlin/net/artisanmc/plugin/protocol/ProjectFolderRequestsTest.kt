package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.PublicationAuthor
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectSnapshot
import java.io.File
import java.nio.file.Files
import java.util.concurrent.Executor
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ProjectFolderRequestsTest {
    private val coreRoot = Files.createTempDirectory("artisan-folder-requests").toFile()
    private val sent = mutableListOf<Map<String, Any?>>()
    private var reloads = 0
    private val reloaded = mutableListOf<Set<String>?>()
    private val workspace = object : ProjectWorkspace {
        override val roots = ProjectRoots(coreRoot)
        override val snapshot = ProjectSnapshot.EMPTY
        override val io = Executor { it.run() }
        override fun reload(projectIds: Set<String>?) { reloads++; reloaded += projectIds }
        override fun authoredBy(projectId: String, author: PublicationAuthor) { authored += Triple(projectId, author.id, author.name) }
    }
    private val authored = mutableListOf<Triple<String, String, String>>()
    private val writes = ProjectWrites(workspace, Replies(workspace.io, { sent += it }, null), { sent += it }, null)
    private val mapper = ObjectMapper()

    @AfterTest fun teardown() { coreRoot.deleteRecursively() }

    private fun dispatch(json: String): Map<String, Any?> {
        when (val request = EditorRequest.parse(mapper.readTree(json))) {
            is EditorRequest.ProjectCreate -> writes.create(request)
            is EditorRequest.ProjectDelete -> writes.delete(request)
            is EditorRequest.ProjectRename -> writes.rename(request)
            else -> error("not a folder request: $json")
        }
        return sent.removeLast()
    }

    @Test fun `create, rename and delete answer and reload`() {
        val created = dispatch("""{"type":"project_create","request_id":"r1","project_id":"shop"}""")
        assertEquals(mapOf("type" to "project_create_result", "request_id" to "r1", "ok" to true), created)
        assertEquals("project_exists", dispatch("""{"type":"project_create","request_id":"r2","project_id":"shop"}""")["error"])

        val renamed = dispatch("""{"type":"project_rename","request_id":"r3","project_id":"shop","target_project_id":"store"}""")
        assertEquals("project_rename_result", renamed["type"])
        assertEquals(true, renamed["ok"])
        assertTrue(File(coreRoot, "store").isDirectory)

        assertEquals(true, dispatch("""{"type":"project_delete","request_id":"r4","project_id":"store"}""")["ok"])
        assertEquals(listOf(".artisan-trash"), coreRoot.list()!!.toList())
        assertEquals(3, reloads)
        val expected: List<Set<String>?> = listOf(setOf("shop"), setOf("shop", "store"), setOf("store"))
        assertEquals(expected, reloaded, "each operation reloads its folders only")
    }

    @Test fun `a publication names its author before the reload`() {
        File(coreRoot, "shop").mkdirs()
        writes.write(EditorRequest.parse(mapper.readTree(
            """{"type":"project_write","request_id":"w1","project_id":"shop","operation_id":"op1","files":[{"path":"a.yml","content":"a: 1"}],"deletes":[],"renames":[],"author_id":"u1","author_name":"Iban"}""",
        )) as EditorRequest.ProjectWrite)
        assertEquals(true, sent.last()["ok"])
        assertEquals(listOf(Triple("shop", "u1", "Iban")), authored)
        assertEquals(1, reloads)
    }

    @Test fun `unsafe ids are refused before touching the disk`() {
        assertEquals("invalid_path", dispatch("""{"type":"project_delete","request_id":"r","project_id":"../x"}""")["error"])
        assertEquals("invalid_path", dispatch("""{"type":"project_rename","request_id":"r","project_id":".artisan-trash","target_project_id":"x"}""")["error"])
        assertEquals(0, reloads)
    }

    @Test fun `deploying refuses a Document that would not load, and writes nothing`() {
        File(coreRoot, "shop").mkdirs()
        writes.write(EditorRequest.parse(mapper.readTree(
            """{"type":"project_write","request_id":"w2","project_id":"shop","operation_id":"op2","files":[{"path":"menus/vip.yml","content":"schema: menu/v1\ntittle: VIP\nsize: 27\n"}],"deletes":[],"renames":[]}""",
        )) as EditorRequest.ProjectWrite)
        val refused = sent.last()
        assertEquals("invalid_documents", refused["error"])
        @Suppress("UNCHECKED_CAST")
        val problems = refused["problems"] as List<Map<String, Any?>>
        assertTrue(problems.any { it["path"] == "menus/vip.yml" && "tittle" in it["message"].toString() }, problems.toString())
        assertTrue(!File(coreRoot, "shop/menus/vip.yml").exists())
        assertEquals(0, reloads)
    }

    @Test fun `publishing a draft goes through the same check`() {
        File(coreRoot, "shop").mkdirs()
        val bad = mapOf(
            "type" to "project_draft_publish", "request_id" to "p1", "project_id" to "shop", "operation_id" to "op3", "blobs" to emptyMap<String, Any>(),
            "draft" to mapOf("snapshot" to mapOf("baseline" to emptyMap<String, String>(), "tree" to mapOf("menus/vip.yml" to "schema: menu/v1\nsize: [27"), "at" to 1)),
        )
        writes.publishDraft(EditorRequest.parse(mapper.valueToTree(bad)) as EditorRequest.ProjectDraftPublish)
        assertEquals("invalid_documents", sent.last()["error"])
        assertTrue(!File(coreRoot, "shop/menus/vip.yml").exists())
        // Metadata the editor owns is not a Document: never refused by the check.
        writes.write(EditorRequest.parse(mapper.readTree(
            """{"type":"project_write","request_id":"w3","project_id":"shop","operation_id":"op4","files":[{"path":".artisan/editor.yaml","content":"folders: []\n"}],"deletes":[],"renames":[]}""",
        )) as EditorRequest.ProjectWrite)
        assertEquals(true, sent.last()["ok"])
    }
}
