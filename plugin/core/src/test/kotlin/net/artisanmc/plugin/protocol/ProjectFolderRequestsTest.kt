package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.PublicationAuthor
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectSnapshot
import net.artisanmc.plugin.project.ServerThemes
import java.io.File
import java.nio.file.Files
import java.util.concurrent.Executor
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProjectFolderRequestsTest {
    private val data = Files.createTempDirectory("artisan-folder-requests").toFile()
    private val coreRoot = File(data, "modules").apply { mkdirs() }
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

    @AfterTest fun teardown() { data.deleteRecursively() }

    private fun dispatch(json: String): Map<String, Any?> {
        when (val request = EditorRequest.parse(mapper.readTree(json))) {
            is EditorRequest.ProjectCreate -> writes.create(request)
            is EditorRequest.ProjectDelete -> writes.delete(request)
            is EditorRequest.ProjectRename -> writes.rename(request)
            is EditorRequest.ProjectWrite -> writes.write(request)
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

    @Test fun `create with the role theme makes a theme's folder, beside the modules`() {
        val created = dispatch("""{"type":"project_create","request_id":"r1","project_id":"noel","role":"theme"}""")
        assertEquals(mapOf("type" to "project_create_result", "request_id" to "r1", "ok" to true), created)
        assertTrue(File(coreRoot.parentFile, "themes/noel").isDirectory)
        assertFalse(File(coreRoot, "noel").exists())
        assertTrue(workspace.roots.isTheme("noel"))
        assertEquals(listOf<Set<String>?>(setOf("noel")), reloaded)
        assertEquals("project_exists", dispatch("""{"type":"project_create","request_id":"r2","project_id":"noel","role":"theme"}""")["error"])
        assertEquals("project_exists", dispatch("""{"type":"project_create","request_id":"r3","project_id":"noel"}""")["error"])
        assertEquals("invalid_name", dispatch("""{"type":"project_create","request_id":"r4","project_id":"Noel","role":"theme"}""")["error"])
        assertEquals("invalid_input", dispatch("""{"type":"project_create","request_id":"r5","project_id":"x","role":"config"}""")["error"])
    }

    @Test fun `a theme created empty takes an archive's files in one write, its images included`() {
        // What the editor's import of a theme sends: the folder, then its files.
        dispatch("""{"type":"project_create","request_id":"r1","project_id":"noel","role":"theme"}""")
        val png = byteArrayOf(-119, 80, 78, 71, 0, 1, 2)
        val written = dispatch(
            """{"type":"project_write","request_id":"r2","project_id":"noel","operation_id":"op-1",
               "files":[{"path":"overrides/colors.yml","content":"colors: {}\n","base_hash":null}],
               "binaries":[{"path":"overrides/artisan/close.1x1.png","content_base64":"${java.util.Base64.getEncoder().encodeToString(png)}","base_hash":null}]}""",
        )
        assertEquals(true, written["ok"], written.toString())
        val theme = File(coreRoot.parentFile, "themes/noel")
        assertEquals("colors: {}\n", File(theme, "overrides/colors.yml").readText())
        assertTrue(File(theme, "overrides/artisan/close.1x1.png").readBytes().contentEquals(png))
        assertFalse(File(coreRoot, "noel").exists(), "written in the theme's folder, not in a module's")
    }

    @Test fun `a theme is renamed and deleted as a theme, the theme artisan never`() {
        val themes = File(coreRoot.parentFile, "themes")
        dispatch("""{"type":"project_create","request_id":"r1","project_id":"noel","role":"theme"}""")
        File(themes, "noel/overrides").mkdirs()
        File(themes, "noel/overrides/colors.yml").writeText("colors: {}\n")
        File(coreRoot, "shop").mkdirs()
        workspace.roots.theme("artisan")

        // A module's name, the theme's own, or a name that is no theme's is refused; nothing moves.
        fun rename(to: String) = dispatch("""{"type":"project_rename","request_id":"r","project_id":"noel","target_project_id":"$to"}""")
        assertEquals("destination_exists", rename("shop")["error"])
        assertEquals("invalid_path", rename("artisan")["error"], "the common images' name is no theme's")
        assertEquals("invalid_path", rename("Noel")["error"])
        assertEquals("invalid_path", rename("noel")["error"])
        assertTrue(workspace.roots.isTheme("noel"))

        assertEquals(true, rename("hiver")["ok"])
        assertTrue(File(themes, "hiver/overrides/colors.yml").isFile)
        assertFalse(File(themes, "noel").exists())
        assertFalse(File(coreRoot, "hiver").exists(), "a theme stays beside the modules")
        assertTrue(workspace.roots.isTheme("hiver") && !workspace.roots.isTheme("noel") && !workspace.roots.isRegistered("noel"))
        assertEquals(setOf("noel", "hiver"), reloaded.last())

        // Deleted: its folder goes to the themes' trash, and it is a Project no more.
        assertEquals(true, dispatch("""{"type":"project_delete","request_id":"r5","project_id":"hiver"}""")["ok"])
        assertFalse(File(themes, "hiver").exists())
        val trashed = File(themes, ".artisan-trash").list()!!.toList()
        assertTrue(trashed.size == 1 && trashed[0].startsWith("hiver-"), trashed.toString())
        assertTrue(File(themes, ".artisan-trash/${trashed[0]}/overrides/colors.yml").isFile)
        assertFalse(workspace.roots.isRegistered("hiver"))
        assertEquals("unknown_project", dispatch("""{"type":"project_delete","request_id":"r6","project_id":"hiver"}""")["error"])
        // The trash is no theme at the next start.
        assertFalse(".artisan-trash" in ServerThemes.register(ProjectRoots(coreRoot)))

        // The common images keep their name: menus look in it.
        assertEquals("addon_immutable", dispatch("""{"type":"project_rename","request_id":"r8","project_id":"artisan","target_project_id":"base"}""")["error"])
        assertTrue(File(themes, "artisan").isDirectory && workspace.roots.isTheme("artisan"))
        // Deleted like any theme (ADR `editable-module-tree`, decision 9).
        assertEquals(true, dispatch("""{"type":"project_delete","request_id":"r7","project_id":"artisan"}""")["ok"])
        assertFalse(File(themes, "artisan").exists())
        assertFalse(workspace.roots.isRegistered("artisan"))
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
