package net.artisanmc.plugin.project

import net.artisanmc.plugin.protocol.EditorPaths
import net.artisanmc.plugin.sync.BundleHasher
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import kotlin.test.assertEquals

/**
 * The `.artisan*` rule (invariants.md): first segment only, case ignored, and
 * every call site answers the same.
 */
class ProjectMetadataPathsTest {
    private data class Case(val path: String, val meta: Boolean, val editorSees: Boolean)

    private val cases = listOf(
        Case(".Artisan/x", meta = true, editorSees = false),
        Case(".ARTISAN/project-id", meta = true, editorSees = false),
        Case(".ARTISAN/history/menus/a.yaml/1", meta = true, editorSees = false),
        Case(".artisan-Trash/a", meta = true, editorSees = false),
        Case(".artisan/editor.yaml", meta = true, editorSees = true),
        Case(".ARTISAN/editor.yaml", meta = true, editorSees = false), // canonical spelling only
        Case("a/.artisan/x", meta = false, editorSees = true),
        Case("menus/shop.yaml", meta = false, editorSees = true),
        Case(".gitignore", meta = false, editorSees = true),
    )

    @TestFactory
    fun `metadata rule`() = cases.map { c ->
        DynamicTest.dynamicTest(c.path) {
            assertEquals(c.meta, ProjectMetadataPaths.isMeta(c.path), "isMeta")
            assertEquals(c.meta, BundleHasher.isArtisanMeta(c.path), "hash exclusion")
            assertEquals(!c.editorSees, EditorPaths.isInvisible(c.path), "project_read")
            assertEquals(c.editorSees, EditorPaths.isWritable(c.path), "project_write")
            assertEquals(!c.meta, EditorPaths.isSafeRelPath(c.path), "relay writes")
        }
    }
}
