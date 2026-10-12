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
        assertEquals(listOf("items.yaml"), reader.list("proj1", "shop"))
        assertEquals(emptyList(), reader.list("proj1", "quests"))
        assertEquals(emptyList(), reader.list("nope", "shop"))
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

    @Test fun `list excludes nested artisan directories`() {
        val files = reader.list("proj1", "shop")
        assertEquals(listOf("items.yaml"), files)
        assertTrue(files.none { it.contains(".artisan") })
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

    @Test fun `direct addon read recovers a pending publication before exposing files`() {
        val project = File(projectsDir, "proj1")
        assertFailsWith<java.io.IOException> {
            ProjectPublisher(project) { throw java.io.IOException("crash") }.commit("op", "request", linkedMapOf("shop/items.yaml" to "new items".toByteArray(), "menus/main.yaml" to "new menu".toByteArray()), com.fasterxml.jackson.databind.ObjectMapper().readTree("{}"))
        }
        assertEquals("new menu", reader.read("proj1", "menus/main.yaml"))
        assertEquals("new items", reader.read("proj1", "shop/items.yaml"))
    }
}
