package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import kotlin.test.*

class ProjectContentReaderTest {
    private lateinit var projectsDir: File
    private lateinit var reader: ProjectContentReader

    @BeforeTest fun setup() {
        projectsDir = Files.createTempDirectory("artisan-projects").toFile()
        File(projectsDir, "proj1/shop").mkdirs()
        File(projectsDir, "proj1/shop/items.yaml").writeText("items: []")
        File(projectsDir, "proj1/shop/.artisan-nested").mkdirs()
        File(projectsDir, "proj1/shop/.artisan-nested/x.yaml").writeText("excluded: true")
        File(projectsDir, "proj1/menus").mkdirs()
        File(projectsDir, "proj1/menus/main.yaml").writeText("id: main")
        File(projectsDir, "proj1/.artisan-sync.yaml").writeText("syncedHash: \"\"")
        File(projectsDir, ".artisan-trash").mkdirs()
        File(projectsDir, "proj2").mkdirs()
        reader = ProjectContentReader(ProjectRoots(projectsDir))
    }

    @AfterTest fun teardown() { projectsDir.deleteRecursively() }

    @Test fun `projectIds lists directories, hidden dirs excluded`() {
        assertEquals(listOf("proj1", "proj2"), reader.projectIds().sorted())
    }

    @Test fun `list returns relative file paths under the dir`() {
        assertEquals(listOf("main.yaml"), reader.list("proj1", "menus"))
        assertEquals(emptyList(), reader.list("proj1", "quests"))
        assertEquals(emptyList(), reader.list("nope", "shop"))
    }

    @Test fun `documents serves the raw documents of a module kind from the loaded runtimes`() {
        val runtimes = listOf(
            net.artisanmc.plugin.engine.RuntimeProject(
                projectId = "proj1", defaultLang = "en", languages = listOf("en"),
                documents = mapOf(
                    "quest" to listOf(
                        net.artisanmc.plugin.model.RuntimeRawDocument("first", "quest", "quest/v1", "proj1", mapOf("schema" to "quest/v1", "name" to "First")),
                    ),
                ),
            ),
        )
        val withRuntimes = ProjectContentReader(ProjectRoots(projectsDir), runtimes = { runtimes })
        assertEquals(listOf(mapOf("schema" to "quest/v1", "name" to "First", "id" to "first")), withRuntimes.documents("proj1", "quest"))
        assertEquals(emptyList(), withRuntimes.documents("proj1", "menu"))
        assertEquals(emptyList(), withRuntimes.documents("proj2", "quest"))
        assertEquals(emptyList(), reader.documents("proj1", "quest"))
    }

    @Test fun `read returns file content or null`() {
        assertEquals("items: []", reader.read("proj1", "shop/items.yaml"))
        assertNull(reader.read("proj1", "shop/missing.yaml"))
    }

    @Test fun `hasContent is true when any project has a non-empty dir`() {
        assertTrue(reader.hasContent("shop"))
        assertFalse(reader.hasContent("quests"))
    }

    @Test fun `path traversal and artisan namespace are rejected`() {
        assertNull(reader.read("proj1", "../proj2/anything"))
        assertNull(reader.read("proj1", "..\\..\\secrets"))
        assertNull(reader.read("proj1", ".artisan-sync.yaml"))
        assertNull(reader.read("../..", "etc/passwd"))
    }

    @Test fun `malformed paths return null instead of throwing`() {
        assertNull(reader.read("proj1", "shop/ bad"))
        assertNull(reader.read("pr oj", "shop/items.yaml"))
    }

    @Test fun `list excludes the project's artisan metadata, not a nested lookalike`() {
        // The rule reads the first segment from the Project's folder (invariants.md):
        // `shop/.artisan-nested/` is content, the editor sees it too.
        assertEquals(listOf(".artisan-nested/x.yaml", "items.yaml"), reader.list("proj1", "shop"))
        assertTrue(reader.list("proj1", "").none { it.startsWith(".artisan") })
    }

    @Test fun `uppercase metadata is not exposed either`() {
        File(projectsDir, "proj1/.ARTISAN").mkdirs()
        File(projectsDir, "proj1/.ARTISAN/project-id").writeText("id")
        assertNull(reader.read("proj1", ".ARTISAN/project-id"))
        assertTrue(reader.list("proj1", "").none { it.contains("project-id") })
    }

    @Test fun `uppercase private namespace is not exposed through addon content API`() {
        val privateFile = File(projectsDir, "proj1/.ARTISAN/drafts/d1/draft.json")
        privateFile.parentFile.mkdirs()
        privateFile.writeText("private")
        assertNull(reader.read("proj1", ".ARTISAN/drafts/d1/draft.json"))
        assertEquals(emptyList(), reader.list("proj1", ".ARTISAN/drafts"))
        assertFalse(reader.hasContent(".ARTISAN/drafts"))
        assertTrue(reader.list("proj1", "").none { it.contains("draft.json") })
    }

    @Test fun `list and read answer from the snapshot when it holds the project`() {
        val loaded = ProjectSnapshot(
            files = mapOf("proj1" to mapOf("menus/main.yaml" to "id: loaded", "shop/items.yaml" to "items: [loaded]", ".artisan/editor.yaml" to "board: {}")),
            binaries = mapOf("proj1" to mapOf("shop/icon.png" to ProjectFilesReader.BinaryInfo("h", 3))),
            skipped = emptyMap(),
        )
        val reader = ProjectContentReader(ProjectRoots(projectsDir), snapshot = { loaded })
        assertEquals("id: loaded", reader.read("proj1", "menus/main.yaml"), "the loaded text, not the disk's")
        assertEquals(listOf("icon.png", "items.yaml"), reader.list("proj1", "shop"))
        assertEquals(listOf("menus/main.yaml", "shop/icon.png", "shop/items.yaml"), reader.list("proj1", ""))
        assertNull(reader.read("proj1", ".artisan/editor.yaml"))
        // A file the snapshot lacks (written since the load) is read from the disk.
        File(projectsDir, "proj1/shop/new.yaml").writeText("new: true")
        assertEquals("new: true", reader.read("proj1", "shop/new.yaml"))
        assertEquals(listOf("icon.png", "items.yaml"), reader.list("proj1", "shop"), "a listing is the loaded one")
        // A Project the snapshot does not hold yet is read from the disk.
        File(projectsDir, "proj2/x/a.yaml").apply { parentFile.mkdirs() }.writeText("a: 1")
        assertEquals(listOf("a.yaml"), reader.list("proj2", "x"))
        assertEquals("a: 1", reader.read("proj2", "x/a.yaml"))
        assertTrue(reader.hasContent("x"))
        assertFalse(reader.hasContent("quests"))
    }

    @Test fun `direct addon read recovers a pending publication before exposing files`() {
        val project = File(projectsDir, "proj1")
        assertFailsWith<java.io.IOException> {
            ProjectPublisher(project) { throw java.io.IOException("crash") }.commit("op", "request", linkedMapOf("shop/items.yaml" to "new items".toByteArray(), "menus/main.yaml" to "new menu".toByteArray()), com.fasterxml.jackson.databind.ObjectMapper().readTree("{}"))
        }
        assertEquals("new menu", reader.read("proj1", "menus/main.yaml"))
        assertEquals("new items", reader.read("proj1", "shop/items.yaml"))
    }
}
