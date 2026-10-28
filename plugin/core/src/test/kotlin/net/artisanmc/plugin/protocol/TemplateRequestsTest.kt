package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.modules.api.template.TemplateRegistry
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectSnapshot
import net.artisanmc.plugin.project.PublicationAuthor
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.Executor
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TemplateRequestsTest {
    private val coreRoot = Files.createTempDirectory("artisan-template-requests").toFile()
    private val sent = mutableListOf<Map<String, Any?>>()
    private var reloads = 0
    private val reloaded = mutableListOf<Set<String>?>()
    private val workspace = object : ProjectWorkspace {
        override val roots = ProjectRoots(coreRoot)
        override val snapshot = ProjectSnapshot.EMPTY
        override val io = Executor { it.run() }
        override fun reload(projectIds: Set<String>?) { reloads++; reloaded += projectIds }
        override fun authoredBy(projectId: String, author: PublicationAuthor) {}
    }
    private val registry = TemplateRegistry().apply {
        bindOwner("quests")
        register(TemplateDeclaration.builder("daily", 1).file("menus/daily.yaml", "title: Daily\n".toByteArray()).build())
        register(TemplateDeclaration.builder("menus", 1).system().file("menus/board.yaml", "title: Board\n".toByteArray()).build())
        bindOwner(null)
    }
    private val requests = TemplateRequests(workspace, Replies(workspace.io, { sent += it }, null)) { net.artisanmc.plugin.project.ModuleTemplates(registry) }
    private val mapper = ObjectMapper()

    @AfterTest fun teardown() { coreRoot.deleteRecursively() }

    private fun dispatch(json: String): Map<String, Any?> {
        when (val request = EditorRequest.parse(mapper.readTree(json))) {
            is EditorRequest.TemplateFetch -> requests.fetch(request)
            is EditorRequest.TemplateCopy -> requests.copy(request)
            is EditorRequest.ProjectOriginsFetch -> requests.origins(request)
            else -> error("not a template request: $json")
        }
        return sent.removeLast()
    }

    @Test
    fun `the messages parse, and need their ids`() {
        assertEquals(
            EditorRequest.TemplateCopy("r", "shop", "quests", "daily", listOf("a.yaml"), true),
            EditorRequest.parse(mapper.readTree("""{"type":"template_copy","request_id":"r","project_id":"shop","module_id":"quests","template_id":"daily","paths":["a.yaml"],"replace":true}""")),
        )
        assertEquals(
            EditorRequest.TemplateCopy("r", "shop", "quests", "daily", null, false),
            EditorRequest.parse(mapper.readTree("""{"type":"template_copy","request_id":"r","project_id":"shop","module_id":"quests","template_id":"daily"}""")),
        )
        assertNull(EditorRequest.parse(mapper.readTree("""{"type":"template_fetch","request_id":"r","module_id":"quests"}""")))
        assertNull(EditorRequest.parse(mapper.readTree("""{"type":"project_origins_fetch","request_id":"r"}""")))
    }

    @Test
    fun `a template's files are sent in base64`() {
        val reply = dispatch("""{"type":"template_fetch","request_id":"r1","module_id":"quests","template_id":"daily"}""")
        assertEquals("template_fetch_result", reply["type"])
        @Suppress("UNCHECKED_CAST")
        val files = reply["files"] as List<Map<String, String>>
        assertEquals("menus/daily.yaml", files.single()["path"])
        assertEquals("title: Daily\n", String(Base64.getDecoder().decode(files.single()["content_base64"])))
        assertEquals("not_found", dispatch("""{"type":"template_fetch","request_id":"r2","module_id":"quests","template_id":"weekly"}""")["error"])
    }

    @Test
    fun `a copy writes, reloads, and reports conflicts without writing`() {
        File(coreRoot, "shop").mkdirs()
        val copy = """{"type":"template_copy","request_id":"r","project_id":"shop","module_id":"quests","template_id":"daily"}"""
        assertEquals(listOf("menus/daily.yml"), dispatch(copy)["written"])
        assertEquals(1, reloads)

        File(coreRoot, "shop/menus/daily.yml").writeText("title: Mine\n")
        val refused = dispatch(copy)
        assertEquals("conflict", refused["error"])
        assertEquals(listOf("menus/daily.yml"), refused["conflicts"])
        assertEquals(1, reloads)

        val origins = dispatch("""{"type":"project_origins_fetch","request_id":"o","project_id":"shop"}""")
        @Suppress("UNCHECKED_CAST")
        val entry = (origins["origins"] as Map<String, Map<String, Any>>).getValue("menus/daily.yml")
        assertEquals("daily", entry["template"])
        // The editor neither sees nor writes the origins: only a copy does.
        assertEquals(true, EditorPaths.isInvisible(".artisan/origins.yaml"))
        assertEquals(false, EditorPaths.isWritable(".artisan/origins.yaml"))
    }

    @Test
    fun `unknown projects, paths and unsafe ids are refused`() {
        assertEquals("unknown_project", dispatch("""{"type":"template_copy","request_id":"r","project_id":"ghost","module_id":"quests","template_id":"daily"}""")["error"])
        assertEquals("unknown_path", dispatch("""{"type":"template_copy","request_id":"r","project_id":"ghost","module_id":"quests","template_id":"daily","paths":["x.yaml"]}""")["error"])
        assertEquals("invalid_path", dispatch("""{"type":"project_origins_fetch","request_id":"r","project_id":"../x"}""")["error"])
        assertEquals(0, reloads)
    }

    @Test
    fun `a system template is copied into its module's folder only, to reset a file`() {
        File(coreRoot, "shop").mkdirs()
        workspace.roots.register("quests_folder", File(coreRoot, "quests_folder").apply { mkdirs() }, "quests")
        val copy = { project: String ->
            """{"type":"template_copy","request_id":"r","project_id":"$project","module_id":"quests","template_id":"menus","replace":true}"""
        }
        assertEquals("system_template", dispatch(copy("shop"))["error"])
        assertEquals(listOf("menus/board.yml"), dispatch(copy("quests_folder"))["written"])
    }
}
