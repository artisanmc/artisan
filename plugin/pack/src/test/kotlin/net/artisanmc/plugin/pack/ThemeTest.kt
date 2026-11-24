package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The same cases as the editor's `theme.test.ts`: the two builders read and apply a theme alike.
class ThemeTest {
    private fun solid(width: Int, height: Int, vararg rgba: Int) = RgbaImage(width, height).also {
        for (i in it.data.indices) it.data[i] = rgba[i % 4].toByte()
    }

    private fun pixel(png: ByteArray, x: Int, y: Int) = Png.decode(png).let { image ->
        (0..3).map { image.data[(y * image.width + x) * 4 + it].toInt() and 0xff }
    }

    private fun kit(files: Map<String, String>, binaries: Map<String, ByteArray> = emptyMap()) =
        PackProject("ui-kit", files.map { PackFile(it.key, it.value) }, binaries.keys.toList(), { binaries[it] })

    private val table = "colors:\n  \"#3c8527\": \"#b3261e\"\n  \"#B3261E\": \"#ffffff\"\n"

    @Test
    fun `the table keeps the pairs of colours, quoted, that change something`() {
        val colors = KitTheme.colors(
            """
            colors:
              "#3c8527": "#b3261e"
              "#B0C88C": '#2E7D32'
              "#123456": "#123456"
              nope: "#000000"
              "#000001": red
              "#0000020": "#000000"
              "#abc": "#000000"
              #f4c842: "#000000"
              "#000003": 7
            """.trimIndent(),
        )
        assertEquals(mapOf(0x3c8527 to 0xb3261e, 0xb0c88c to 0x2e7d32), colors)
        assertEquals(emptyMap(), KitTheme.colors("colors: [a, b]\n"))
        assertEquals(emptyMap(), KitTheme.colors("name: Noël\n"))
        assertEquals(emptyMap(), KitTheme.colors("colors: {unclosed\n"))
        // The same colour twice is a file the editor does not read either.
        assertEquals(emptyMap(), KitTheme.colors("colors:\n  \"#000000\": \"#111111\"\n  \"#000000\": \"#222222\"\n"))
    }

    @Test
    fun `a theme is a folder of the kit module with a file or a redrawn image`() {
        val files = listOf("themes/noel/theme.yml", "themes/noel/theme.yaml", "themes/empty/notes.txt", "themes/Bad Name/theme.yml", "themes/theme.yml", "data/ui-kit.yml")
        val binaries = listOf(
            "themes/halloween/assets/textures/button.3x1.png",
            "themes/noel/assets/glyphs/banner.png",
            "themes/noel/assets/textures/banner.png",
            "themes/noel/assets/glyphs/star.png",
            "themes/noel/assets/textures/deep/button.3x1.png",
            "themes/noel/assets/other/button.3x1.png",
            "themes/noel/assets/textures/.png",
            "themes/noel/button.3x1.png",
            "themes/elsewhere/button.3x1.png",
        )
        assertEquals(listOf("halloween", "noel"), KitTheme.names(files, binaries))
        assertEquals("themes/noel/theme.yml", KitTheme.file("noel", files))
        assertEquals("themes/noel/theme.yaml", KitTheme.file("noel", files - "themes/noel/theme.yml"))
        assertNull(KitTheme.file("halloween", files))
        // A texture wins over a glyph of the same name; what is not right under the two folders is no image.
        assertEquals(
            mapOf("banner" to "themes/noel/assets/textures/banner.png", "star" to "themes/noel/assets/glyphs/star.png"),
            KitTheme.drawings("noel", binaries),
        )
        assertNull(KitTheme.read("nowhere", kit(mapOf("themes/noel/theme.yml" to table))))
        assertNull(KitTheme.read("Bad Name", kit(mapOf("themes/Bad Name/theme.yml" to table))))
        assertNotNull(KitTheme.read("halloween", kit(emptyMap(), mapOf("themes/halloween/assets/textures/a.png" to byteArrayOf(1)))))
    }

    @Test
    fun `colours are replaced once, whatever the alpha above zero`() {
        val theme = assertNotNull(KitTheme.read("noel", kit(mapOf("themes/noel/theme.yml" to table))))
        val image = RgbaImage(4, 1)
        intArrayOf(0x3c, 0x85, 0x27, 255, 0x3c, 0x85, 0x27, 128, 0x3c, 0x85, 0x27, 0, 0xb3, 0x26, 0x1e, 255)
            .forEachIndexed { i, v -> image.data[i] = v.toByte() }
        val png = Png.encode(image)
        val out = theme.shown("button.3x1", png)
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(out, 0, 0))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 128), pixel(out, 1, 0))
        assertEquals(listOf(0x3c, 0x85, 0x27, 0), pixel(out, 2, 0))
        // What was red becomes white; what became red stays red.
        assertEquals(listOf(255, 255, 255, 255), pixel(out, 3, 0))
        // No colour of the table: the very same file, not one encoded again.
        val other = Png.encode(solid(2, 2, 1, 2, 3, 255))
        assertTrue(theme.shown("x", other) === other)
        val broken = byteArrayOf(1, 2, 3)
        assertTrue(theme.shown("x", broken) === broken)
    }

    @Test
    fun `an image the theme redraws at its size is taken as it is`() {
        val drawn = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val small = Png.encode(solid(1, 1, 9, 9, 9, 255))
        val theme = assertNotNull(
            KitTheme.read(
                "noel",
                kit(
                    mapOf("themes/noel/theme.yml" to table),
                    mapOf(
                        "themes/noel/assets/textures/close.png" to drawn,
                        "themes/noel/assets/textures/back.png" to small,
                        "themes/noel/assets/textures/broken.png" to byteArrayOf(1, 2, 3),
                    ),
                ),
            ),
        )
        assertEquals(setOf("back", "broken", "close"), theme.drawings)
        val base = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        // Its own colours are not replaced: it is drawn in the theme already.
        assertTrue(theme.shown("close", base) === drawn)
        assertTrue(theme.drawing("close", base) === drawn)
        // Another size, or unreadable: left out, the image takes the theme's colours.
        assertNull(theme.drawing("back", base))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(theme.shown("back", base), 0, 0))
        assertNull(theme.drawing("broken", base))
        assertNull(theme.drawing("other", base))
    }

    @Test
    fun `a theme file about to be written says what is wrong in it, and a server's config names its theme`() {
        assertEquals(emptyList(), KitTheme.problems("colors:\n  \"#3c8527\": \"#b3261e\"\n"))
        assertEquals(emptyList(), KitTheme.problems("colors: {}\n"))
        // Unquoted, `#` starts a comment: the table is empty, which is said rather than written.
        assertTrue("Quote" in KitTheme.problems("colors:\n  #3c8527: #b3261e\n").single())
        assertTrue("not a YAML map" in KitTheme.problems("- a\n").single())
        assertEquals(
            listOf("`colors`: 'green' is not a colour as \"#rrggbb\".", "`colors`: '#3c8527' is replaced by 'red', which is not a colour as \"#rrggbb\"."),
            KitTheme.problems("colors:\n  green: \"#b3261e\"\n  \"#3c8527\": red\n"),
        )
        assertEquals("noel", KitTheme.nameOfFile("themes/noel/theme.yml"))
        assertEquals("noel", KitTheme.nameOfFile("themes/noel/theme.yaml"))
        assertNull(KitTheme.nameOfFile("themes/noel/assets/theme.yml"))
        assertNull(KitTheme.nameOfFile("menus/theme.yml"))

        assertEquals("noel", KitTheme.configured(mapOf("resource-pack.theme" to "noel")))
        for (none in listOf(null, emptyMap(), mapOf("resource-pack.theme" to ""), mapOf("resource-pack.theme" to "../x"), mapOf("resource-pack.theme" to 3))) {
            assertNull(KitTheme.configured(none))
        }
    }
}
