package net.artisanmc.plugin.project

import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ArtisanThemeTest {
    @TempDir lateinit var data: File

    private val base = mapOf("button.3x1" to byteArrayOf(1, 2, 3), "close.1x1" to byteArrayOf(4, 5))
    private fun roots() = ProjectRoots(File(data, "modules").apply { mkdirs() })

    @Test
    fun `the theme is a Project of its own, beside the modules, with the role theme`() {
        val roots = roots()
        File(roots.coreRoot, "guilds").mkdirs()
        val dir = ArtisanTheme.register(roots)
        assertEquals(File(data, "themes/artisan").absoluteFile, dir!!.absoluteFile)
        assertEquals(setOf("artisan", "guilds"), roots.all().keys)
        assertTrue(roots.isTheme("artisan"))
        assertEquals("theme", roots.descriptor("artisan")["role"])
        assertEquals(null, roots.descriptor("guilds")["role"])
    }

    @Test
    fun `the base is written at its own paths, once, follows Artisan where untouched, and the server's redraw stays`() {
        val dir = ArtisanTheme.register(roots())!!
        val written = ArtisanTheme.sync(dir, base)
        assertTrue("assets/textures/button.3x1.png" in written, written.toString())
        assertContentEquals(byteArrayOf(4, 5), File(dir, "assets/textures/close.1x1.png").readBytes())
        assertFalse(File(dir, "originals").exists())
        assertEquals("artisan", ShippedIndex.read(dir).getValue("assets/textures/close.1x1.png").module)
        assertEquals(emptyList(), ArtisanTheme.sync(dir, base), "nothing on a start where the base did not change")

        // The server redraws one in place.
        File(dir, "assets/textures/button.3x1.png").writeBytes(byteArrayOf(9, 9, 9))
        ArtisanTheme.sync(dir, base)
        assertContentEquals(byteArrayOf(9, 9, 9), File(dir, "assets/textures/button.3x1.png").readBytes())

        // A new version of Artisan changes the base and drops an image: the untouched one goes, the redraw stays.
        ArtisanTheme.sync(dir, mapOf("button.3x1" to byteArrayOf(7)))
        assertFalse(File(dir, "assets/textures/close.1x1.png").exists())
        assertContentEquals(byteArrayOf(9, 9, 9), File(dir, "assets/textures/button.3x1.png").readBytes())
    }

    @Test
    fun `a theme not migrated yet keeps its base under originals`() {
        val dir = ArtisanTheme.register(roots())!!
        File(dir, "originals").mkdirs()
        val written = ArtisanTheme.sync(dir, base)
        assertTrue("originals/assets/textures/button.3x1.png" in written, written.toString())
        assertFalse(File(dir, "assets/textures/button.3x1.png").exists())
    }

    @Test
    fun `the base's components are written at their path, and the server's own of a name stays`() {
        val dir = ArtisanTheme.register(roots())!!
        val confirm = "parts:\n  - image: button.3x1\n"
        val written = ArtisanTheme.sync(dir, base, mapOf("confirm" to confirm))
        assertTrue("components/confirm.yml" in written, written.toString())
        assertEquals(confirm, File(dir, "components/confirm.yml").readText())
        assertEquals(emptyList(), ArtisanTheme.sync(dir, base, mapOf("confirm" to confirm)))

        // The server writes its own confirm: never replaced.
        File(dir, "components/confirm.yml").writeText("parts:\n  - image: mine\n")
        ArtisanTheme.sync(dir, base, mapOf("confirm" to confirm))
        assertEquals("parts:\n  - image: mine\n", File(dir, "components/confirm.yml").readText())

        // A version that ships none leaves the server's.
        ArtisanTheme.sync(dir, base)
        assertTrue(File(dir, "components/confirm.yml").exists())
    }

    @Test
    fun `the former ui-kit module moves into a theme that holds only what Artisan wrote`() {
        val roots = roots()
        File(data, "themes/artisan").mkdirs()
        ArtisanTheme.sync(File(data, "themes/artisan"), base)
        val legacy = File(roots.coreRoot, "ui-kit")
        File(legacy, "assets/textures").mkdirs()
        File(legacy, "assets/textures/mine.png").writeBytes(byteArrayOf(8))
        val dir = ArtisanTheme.register(roots)
        assertFalse(legacy.exists())
        assertContentEquals(byteArrayOf(8), File(dir, "assets/textures/mine.png").readBytes())
    }

    @Test
    fun `the former ui-kit module moves into the theme, its images under the same names`() {
        val roots = roots()
        val legacy = File(roots.coreRoot, "ui-kit")
        File(legacy, "assets/textures").mkdirs()
        File(legacy, "assets/textures/button.3x1.png").writeBytes(byteArrayOf(8))
        File(legacy, "data").mkdirs()
        File(legacy, "data/ui-kit.yml").writeText("notes: flat\n")
        File(legacy, ".artisan").mkdirs()
        File(legacy, ".artisan/project-id").writeText("11111111-1111-1111-1111-111111111111\n")
        // The theme as a start before the move left it: originals alone.
        File(data, "themes/artisan/originals/assets/textures").mkdirs()

        val dir = ArtisanTheme.register(roots)
        assertFalse(legacy.exists())
        assertContentEquals(byteArrayOf(8), File(dir, "assets/textures/button.3x1.png").readBytes())
        assertEquals("notes: flat\n", File(dir, "data/ui-kit.yml").readText())
        assertEquals(setOf("artisan"), roots.all().keys)
        assertEquals("addon:artisan", roots.key("artisan"))
    }

    @Test
    fun `a ui-kit module stays a module while the theme holds the server's files too`() {
        val roots = roots()
        File(roots.coreRoot, "ui-kit/assets/textures").mkdirs()
        File(roots.coreRoot, "ui-kit/assets/textures/a.png").writeBytes(byteArrayOf(1))
        File(data, "themes/artisan/assets/textures").mkdirs()
        File(data, "themes/artisan/assets/textures/b.png").writeBytes(byteArrayOf(2))
        ArtisanTheme.register(roots)
        assertEquals(setOf("artisan", "ui-kit"), roots.all().keys)
        assertTrue(File(roots.coreRoot, "ui-kit/assets/textures/a.png").isFile)
    }

    @Test
    fun `a deleted theme is not seeded again, and comes back with its base when installed`() {
        val roots = roots()
        val seeds = TemplateSeeds(roots)
        assertTrue(ArtisanTheme.register(roots, seeds = seeds) != null)
        assertTrue(ArtisanTheme.SEED in seeds.seeded())
        assertEquals(null, ServerThemes.delete(roots, ArtisanTheme.NAME))
        assertFalse(File(data, "themes/artisan").exists())
        assertTrue(File(data, "themes/.artisan-trash").list()!!.single().startsWith("artisan-"))

        // The next start: no theme, no Project.
        val restarted = roots()
        assertEquals(null, ArtisanTheme.register(restarted, seeds = TemplateSeeds(restarted)))
        assertFalse(File(data, "themes/artisan").exists())
        assertFalse(restarted.isRegistered(ArtisanTheme.NAME))

        // Installed again from the editor: registered, its base written at once.
        ArtisanTheme.base = { base to emptyMap() }
        try {
            assertEquals(null, ServerThemes.create(restarted, ArtisanTheme.NAME))
            assertTrue(restarted.isTheme(ArtisanTheme.NAME))
            assertContentEquals(byteArrayOf(1, 2, 3), File(data, "themes/artisan/assets/textures/button.3x1.png").readBytes())
            assertEquals("project_exists", ServerThemes.create(restarted, ArtisanTheme.NAME))
        } finally {
            ArtisanTheme.base = null
        }
    }
}
