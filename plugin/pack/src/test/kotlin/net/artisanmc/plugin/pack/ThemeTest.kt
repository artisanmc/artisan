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

    @Test
    fun `a theme is a folder of the kit module with a redrawn image`() {
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
            "themes/Bad Name/assets/textures/a.png",
        )
        assertEquals(listOf("halloween", "noel"), KitTheme.names(binaries))
        // A texture wins over a glyph of the same name; what is not right under the two folders is no image.
        assertEquals(
            mapOf("banner" to "themes/noel/assets/textures/banner.png", "star" to "themes/noel/assets/glyphs/star.png"),
            KitTheme.drawings("noel", binaries),
        )
        // A table of colours is no theme: a theme changes an image by holding an image.
        assertNull(KitTheme.read("noel", kit(mapOf("themes/noel/theme.yml" to "colors:\n  \"#3c8527\": \"#b3261e\"\n"))))
        assertNull(KitTheme.read("Bad Name", kit(emptyMap(), mapOf("themes/Bad Name/assets/textures/a.png" to byteArrayOf(1)))))
        assertNotNull(KitTheme.read("halloween", kit(emptyMap(), mapOf("themes/halloween/assets/textures/a.png" to byteArrayOf(1)))))
    }

    @Test
    fun `an image the theme redraws at its size is taken as it is`() {
        val drawn = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val small = Png.encode(solid(1, 1, 9, 9, 9, 255))
        val theme = assertNotNull(
            KitTheme.read(
                "noel",
                kit(
                    emptyMap(),
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
        assertTrue(theme.shown("close", base) === drawn)
        assertTrue(theme.drawing("close", base) === drawn)
        // Another size, or unreadable: left out, the image stays the very same file.
        assertNull(theme.drawing("back", base))
        assertTrue(theme.shown("back", base) === base)
        assertNull(theme.drawing("broken", base))
        assertNull(theme.drawing("other", base))
        val broken = byteArrayOf(1, 2, 3)
        assertTrue(theme.shown("close", broken) === broken)
    }

    @Test
    fun `the themes in place are the list, the lowest first, else the former single theme`() {
        assertEquals(emptyList(), KitTheme.configured(null))
        assertEquals(emptyList(), KitTheme.configured(emptyMap()))
        assertEquals(listOf("noel"), KitTheme.configured(mapOf("resource-pack.theme" to "noel")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.theme" to "")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.theme" to "Bad Name")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.theme" to 3)))
        // The list wins; a name that is not one, or said twice, is left out.
        assertEquals(
            listOf("noel", "nuit"),
            KitTheme.configured(mapOf("resource-pack.themes" to listOf("noel", "Bad Name", 3, "nuit", "noel"), "resource-pack.theme" to "paques")),
        )
        // An empty list leaves the former key its say: a config that was never rewritten.
        assertEquals(listOf("paques"), KitTheme.configured(mapOf("resource-pack.themes" to emptyList<String>(), "resource-pack.theme" to "paques")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.themes" to "noel")))
    }

    @Test
    fun `themes in place stack, the highest that draws an image wins`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val drawn = Png.encode(solid(2, 2, 0xb3, 0x26, 0x1e, 255))
        val top = Png.encode(solid(2, 2, 7, 7, 7, 255))
        val binaries = mapOf("themes/noel/assets/textures/close.png" to drawn, "themes/haut/assets/textures/close.png" to top)
        fun stack(vararg names: String) = KitTheme.stack(names.toList(), kit(emptyMap(), binaries))
        assertNull(stack())
        assertNull(stack("nowhere"))
        assertTrue(stack("noel")!!.shown("x", green) === green)
        assertNull(stack("noel")!!.drawing("x", green))
        assertTrue(stack("noel", "haut")!!.shown("close", green) === top)
        assertTrue(stack("noel", "haut")!!.drawing("close", green) === top)
        assertTrue(stack("haut", "noel")!!.drawing("close", green) === drawn)
        // A theme the module does not hold is left out of the stack.
        assertTrue(stack("noel", "nowhere")!!.shown("close", green) === drawn)
    }

    @Test
    fun `a theme of its own folder holds images under names, in assets or the former overrides artisan`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val drawn = Png.encode(solid(2, 2, 9, 9, 9, 255))
        val binaries = listOf(
            "overrides/artisan/close.png", "overrides/artisan/deep/close.png", "overrides/artisan/.png", "overrides/artisan/notes.txt",
            "overrides/guilds/banner.png", "overrides/close.png", "assets/glyphs/star.png", "assets/textures/star.png", "assets/textures/deep/star.png",
        ).associateWith { drawn }
        // An image under `assets/` is the theme's image of that name, a texture before a glyph.
        assertEquals(
            mapOf("close" to "overrides/artisan/close.png", "star" to "assets/textures/star.png"),
            KitTheme.ownDrawings(binaries.keys),
        )
        // It wins over the former place of a redraw.
        assertEquals(
            mapOf("close" to "assets/glyphs/close.png"),
            KitTheme.ownDrawings(listOf("overrides/artisan/close.png", "assets/glyphs/close.png")),
        )
        // The table of colours a theme once held repaints nothing.
        val theme = KitTheme.own(kit(mapOf("overrides/colors.yml" to "colors:\n  \"#3c8527\": \"#b3261e\"\n"), binaries))
        assertTrue(theme.shown("x", green) === green)
        assertTrue(theme.shown("close", green) === drawn)
        // Its redraw aimed at a module is no drawing of the common image of that name.
        assertTrue(theme.shown("banner", green) === green)
        assertEquals(setOf("close", "star"), theme.drawings)
        assertTrue(KitTheme.own(kit(emptyMap())).shown("x", green) === green)
    }

    @Test
    fun `a theme in place is the Project of its name, else the folder the common images keep`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val former = Png.encode(solid(2, 2, 1, 1, 1, 255))
        val own = Png.encode(solid(2, 2, 2, 2, 2, 255))
        val night = Png.encode(solid(2, 2, 3, 3, 3, 255))
        val common = kit(emptyMap(), mapOf("themes/noel/assets/textures/close.png" to former, "themes/nuit/assets/textures/back.png" to night))
        val themes = mapOf("noel" to kit(emptyMap(), mapOf("overrides/artisan/close.png" to own)))
        // `noel` is read from its own folder, `nuit` where the common images keep it.
        val stack = KitTheme.stack(listOf("noel", "nuit", "nowhere"), common, themes)!!
        assertTrue(stack.shown("close", green) === own)
        assertTrue(stack.shown("back", green) === night)
        // Without the common images' Project, the themes of their own folder are still read.
        assertTrue(KitTheme.stack(listOf("noel", "nuit"), null, themes)!!.shown("close", green) === own)
        assertNull(KitTheme.stack(listOf("nuit"), null, themes))
        assertNull(KitTheme.stack(listOf("Bad Name"), common, mapOf("Bad Name" to kit(emptyMap()))))
    }
}
