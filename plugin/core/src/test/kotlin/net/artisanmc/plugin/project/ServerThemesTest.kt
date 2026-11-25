package net.artisanmc.plugin.project

import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ServerThemesTest {
    @TempDir lateinit var data: File

    private fun roots() = ProjectRoots(File(data, "modules").apply { mkdirs() })
    private fun file(path: String, bytes: ByteArray = byteArrayOf(1)) = File(data, path).apply { parentFile.mkdirs(); writeBytes(bytes) }

    @Test
    fun `each folder of themes is a theme, a Project of its name that holds no Document`() {
        val roots = roots()
        File(roots.coreRoot, "guilds").mkdirs()
        file("themes/noel/overrides/colors.yml")
        File(data, "themes/empty").mkdirs()
        File(data, "themes/Bad Name").mkdirs()
        File(data, "themes/.hidden").mkdirs()
        ArtisanTheme.register(roots)
        assertEquals(listOf("empty", "noel"), ServerThemes.register(roots))
        assertEquals(setOf("artisan", "empty", "guilds", "noel"), roots.all().keys)
        assertEquals("theme", roots.descriptor("noel")["role"])
        assertEquals(File(data, "themes/noel").absoluteFile, roots.dirFor("noel").absoluteFile)
        assertFalse(roots.holdsDocuments("noel"))
        // The theme `artisan` came from a module, and a module holds Documents.
        assertTrue(roots.holdsDocuments("artisan"))
        assertTrue(roots.holdsDocuments("guilds"))
    }

    @Test
    fun `a theme never hides a module of its name`() {
        val roots = roots()
        File(roots.coreRoot, "guilds/menus").mkdirs()
        file("themes/guilds/overrides/colors.yml")
        assertEquals(emptyList(), ServerThemes.register(roots))
        assertFalse(roots.isTheme("guilds"))
        assertEquals(File(roots.coreRoot, "guilds").absoluteFile, roots.dirFor("guilds").absoluteFile)

        // An Add-on that registers its root after the theme takes the name back.
        file("themes/quests/overrides/colors.yml")
        assertEquals(listOf("quests"), ServerThemes.register(roots))
        val addon = File(data, "addon/quests").apply { mkdirs() }
        roots.register("quests", addon, "quests")
        assertFalse(roots.isTheme("quests"))
        assertEquals(addon.absoluteFile, roots.dirFor("quests").absoluteFile)
        assertNull(roots.descriptor("quests")["role"])
    }

    @Test
    fun `a theme the theme artisan held moves to its own folder, in a theme's layout`() {
        val roots = roots()
        file("themes/artisan/assets/textures/button.3x1.png", byteArrayOf(9))
        file("themes/artisan/themes/noel/theme.yml", "colors: {\"#3c8527\": \"#b3261e\"}\n".toByteArray())
        file("themes/artisan/themes/noel/theme.yaml", "colors: {}\n".toByteArray())
        file("themes/artisan/themes/noel/assets/textures/button.3x1.png", byteArrayOf(2))
        file("themes/artisan/themes/noel/assets/glyphs/button.3x1.png", byteArrayOf(3))
        file("themes/artisan/themes/noel/assets/glyphs/star.png", byteArrayOf(4))
        file("themes/artisan/themes/noel/notes.txt", "red".toByteArray())
        ArtisanTheme.register(roots)
        // The start moves it, then registers it where it is now.
        assertEquals(listOf("noel"), ServerThemes.register(roots))
        assertTrue(roots.isTheme("noel"))

        val noel = File(data, "themes/noel")
        assertEquals("colors: {\"#3c8527\": \"#b3261e\"}\n", File(noel, "overrides/colors.yml").readText())
        // A texture wins over a glyph of the same name, as it did when the theme was read in place.
        assertContentEquals(byteArrayOf(2), File(noel, "overrides/artisan/button.3x1.png").readBytes())
        assertContentEquals(byteArrayOf(4), File(noel, "overrides/artisan/star.png").readBytes())
        assertEquals("red", File(noel, "notes.txt").readText())
        assertFalse(File(noel, "theme.yml").exists())
        assertFalse(File(noel, "theme.yaml").exists())
        assertFalse(File(noel, "assets/textures").exists())
        // The glyph a texture hid stays where it was: nothing is deleted that was never read as lost.
        assertContentEquals(byteArrayOf(3), File(noel, "assets/glyphs/button.3x1.png").readBytes())
        assertFalse(File(data, "themes/artisan/themes").exists())
        // The common images do not move.
        assertContentEquals(byteArrayOf(9), File(data, "themes/artisan/assets/textures/button.3x1.png").readBytes())
        // A second start finds nothing to move.
        assertEquals(emptyList(), ServerThemes.migrate(roots))
    }

    @Test
    fun `a theme whose name is taken stays where it is`() {
        val roots = roots()
        File(roots.coreRoot, "guilds").mkdirs()
        file("themes/artisan/themes/guilds/theme.yml")
        file("themes/artisan/themes/noel/theme.yml", byteArrayOf(5))
        file("themes/noel/overrides/colors.yml", byteArrayOf(6))
        file("themes/artisan/themes/artisan/theme.yml")
        file("themes/artisan/themes/Bad Name/theme.yml")
        ArtisanTheme.register(roots)
        assertEquals(emptyList(), ServerThemes.migrate(roots))
        assertEquals(listOf("noel"), ServerThemes.register(roots))
        assertTrue(File(data, "themes/artisan/themes/guilds/theme.yml").isFile)
        assertTrue(File(data, "themes/artisan/themes/noel/theme.yml").isFile)
        assertTrue(File(data, "themes/artisan/themes/artisan/theme.yml").isFile)
        assertTrue(File(data, "themes/artisan/themes/Bad Name/theme.yml").isFile)
        assertContentEquals(byteArrayOf(6), File(data, "themes/noel/overrides/colors.yml").readBytes())
        assertFalse(File(data, "themes/guilds").exists())
    }

    @Test
    fun `a theme is created empty and registered at once, under a name nothing has`() {
        val roots = roots()
        File(roots.coreRoot, "guilds").mkdirs()
        ArtisanTheme.register(roots)
        assertNull(ServerThemes.create(roots, "noel"))
        assertTrue(File(data, "themes/noel").isDirectory)
        assertTrue(roots.isTheme("noel"))
        assertEquals("theme", roots.descriptor("noel")["role"])
        assertEquals("project_exists", ServerThemes.create(roots, "noel"))
        // A module's name, the common images' and a name that differs by its case alone are taken.
        assertEquals("project_exists", ServerThemes.create(roots, "guilds"))
        assertEquals("invalid_name", ServerThemes.create(roots, "artisan"))
        assertEquals("invalid_name", ServerThemes.create(roots, "Noel"))
        assertEquals("invalid_name", ServerThemes.create(roots, "../x"))
        File(data, "themes/Hiver").mkdirs()
        assertEquals("project_exists", ServerThemes.create(roots, "hiver"))
        assertFalse(roots.isTheme("guilds"))
        // The next start finds it again.
        val restarted = roots()
        ArtisanTheme.register(restarted)
        assertEquals(listOf("noel"), ServerThemes.register(restarted))
    }
}
