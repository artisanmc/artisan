package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ProjectRenamerTest {
    private fun root(): File = Files.createTempDirectory("artisan_rename").toFile()
    private fun project(root: File, id: String) = File(root, id).apply {
        mkdirs()
        File(this, "manifest.yaml").writeText("schema: manifest/v1\n")
    }

    @Test
    fun `retry after restart preserves content and operation identity`() {
        val dir = root()
        project(dir, "old")
        assertNull(ProjectRoots(dir).renamer.rename("op1", "old", "new"))
        val restarted = ProjectRoots(dir)
        assertNull(restarted.renamer.rename("op1", "old", "new"))
        assertEquals("operation_conflict", restarted.renamer.rename("op1", "old", "elsewhere"))
        assertEquals(setOf("new"), restarted.all().keys)
        assertEquals(1, restarted.renamer.completed().size)
    }

    @Test
    fun `addon source and occupied target are never moved`() {
        val dir = root()
        val roots = ProjectRoots(dir)
        project(dir, "old")
        val addon = project(root(), "content")
        roots.register("boutique_addon", addon)
        assertEquals("addon_owned", roots.renamer.rename("op1", "boutique_addon", "new"))
        assertEquals("destination_exists", roots.renamer.rename("op2", "old", "boutique_addon"))
        project(dir, "taken")
        assertEquals("destination_exists", roots.renamer.rename("op3", "old", "taken"))
        assertTrue(addon.isDirectory)
        assertTrue(File(dir, "old").isDirectory)
    }

    @Test
    fun `case-only rename moves through invisible staging`() {
        val dir = root()
        project(dir, "project")
        val roots = ProjectRoots(dir)
        assertNull(roots.renamer.rename("op1", "project", "Project"))
        assertEquals(setOf("Project"), roots.all().keys)
        assertFalse(roots.renamer.isRetired("Project"))
        assertTrue(roots.renamer.isRetired("project"))
        assertNull(ProjectRoots(dir).renamer.rename("op1", "project", "Project"))
    }

    @Test
    fun `recovery finishes every interrupted filesystem step before discovery`() {
        for (step in listOf("intent", "staged", "moved")) {
            val dir = root()
            val journal = File(dir, ".artisan-renames").apply { mkdirs() }
            File(journal, "op1.json").writeText("""{"operation_id":"op1","project_id":"old","target_project_id":"new","complete":false}""")
            val tree = when (step) {
                "intent" -> project(dir, "old")
                "staged" -> project(journal, "op1.tree")
                else -> project(dir, "new")
            }
            File(tree, ".artisan").mkdirs()
            File(tree, ".artisan/rename-operation.json").writeText("op1")
            File(tree, ".artisan/drafts").mkdirs()
            File(tree, ".artisan/drafts/private.json").writeText("draft")
            val roots = ProjectRoots(dir)
            assertEquals(setOf("new"), roots.all().keys, step)
            assertNull(roots.renamer.rename("op1", "old", "new"))
            assertEquals("draft", File(dir, "new/.artisan/drafts/private.json").readText())
            assertFalse(net.artisanmc.plugin.sync.ProjectFilesReader.readAll(File(dir, "new")).containsKey(".artisan/rename-operation.json"))
        }
    }

    @Test
    fun `blocked recovery hides involved roots without preventing unrelated runtime projects`() {
        val dir = root()
        project(dir, "old")
        project(dir, "new")
        project(dir, "unrelated")
        val journal = File(dir, ".artisan-renames").apply { mkdirs() }
        File(journal, "op1.json").writeText("""{"operation_id":"op1","project_id":"old","target_project_id":"new","complete":false}""")
        val roots = ProjectRoots(dir)
        assertEquals(setOf("unrelated"), roots.all().keys)
        assertTrue(roots.renamer.isPending("new"))
        assertTrue(roots.renamer.completed().isEmpty())
        assertTrue(File(dir, "old/manifest.yaml").isFile)
        assertTrue(File(dir, "new/manifest.yaml").isFile)
    }

    @Test
    fun `historical ids remain reserved against stale writes and rename reuse`() {
        val dir = root()
        project(dir, "old")
        val roots = ProjectRoots(dir)
        assertNull(roots.renamer.rename("op1", "old", "new"))
        assertEquals("destination_reserved", roots.renamer.rename("op2", "new", "old"))
        assertTrue(roots.renamer.isRetired("old"))
        if (File.separatorChar == '\\') assertTrue(roots.renamer.isRetired("OLD"))
    }
}
