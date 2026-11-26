package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The same cases as `imageFunction.test.ts`: the two builders refuse the same images. */
class ImageFunctionsTest {
    private val files = listOf(
        PackFile("originals/assets/textures/panel.yml", "function: menu\n"),
        PackFile("originals/assets/textures/badge.yaml", "function: hud\n"),
        PackFile("originals/assets/textures/free.yml", "width: 8\n"),
        PackFile("originals/assets/glyphs/coin.yml", "function: glyph\nheight: 8\nascent: 7\ncodepoint: 57344\n"),
        PackFile("originals/assets/glyphs/gem.yml", "function: glyph\nheight: 8\nascent: 7\n"),
        PackFile("originals/assets/glyphs/star.yml", "function: glyph\nheight: 8\nascent: 7\n"),
        // The owner's descriptor says another ascent; `star` has none and reads the original's.
        PackFile("assets/glyphs/gem.yml", "height: 8\nascent: 9\n"),
        PackFile("assets/glyphs/coin.yaml", "height: 8\nascent: 7\ncodepoint: 57344\n"),
        // No original under this name: nothing to measure against.
        PackFile("assets/textures/mine.yml", "function: menu\n"),
    )
    private val binaries = listOf(
        "originals/assets/textures/panel.png",
        "originals/assets/textures/badge.png",
        "originals/assets/textures/free.png",
        "originals/assets/glyphs/coin.png",
        "originals/assets/glyphs/gem.png",
        "originals/assets/glyphs/star.png",
        "assets/textures/panel.png",
        "assets/textures/badge.png",
        "assets/textures/free.png",
        "assets/textures/mine.png",
        "assets/glyphs/coin.png",
        "assets/glyphs/gem.png",
        "assets/glyphs/star.png",
    )
    private val sizes = mapOf(
        "originals/assets/textures/panel.png" to (20 to 10),
        "assets/textures/panel.png" to (20 to 10),
        "originals/assets/textures/badge.png" to (12 to 12),
        "assets/textures/badge.png" to (16 to 12),
    )

    @Test
    fun `a function is one of menu, glyph and hud`() {
        assertEquals("menu", ImageFunctions.of(mapOf("function" to "menu")))
        assertEquals("glyph", ImageFunctions.of(mapOf("function" to "glyph")))
        assertEquals("hud", ImageFunctions.of(mapOf("function" to "hud")))
        assertNull(ImageFunctions.of(mapOf("function" to "button")))
        assertNull(ImageFunctions.of(mapOf("function" to 3)))
        assertNull(ImageFunctions.of(emptyMap<String, Any?>()))
        assertNull(ImageFunctions.of(null))
    }

    @Test
    fun `the owner's image at other measures than its original's is told`() {
        assertEquals(
            listOf("assets/textures/badge.png", "assets/glyphs/gem.png"),
            ImageFunctions.otherMeasures(files, binaries) { sizes[it] }.map { it.path },
        )
        // Without the pixels, a menu or HUD image is not counted; a glyph is still measured.
        assertEquals(listOf("assets/glyphs/gem.png"), ImageFunctions.otherMeasures(files, binaries, null).map { it.path })
        // An owner's file that is no image counts; an original that is none measures nothing.
        assertEquals(
            listOf("assets/textures/panel.png", "assets/glyphs/gem.png"),
            ImageFunctions.otherMeasures(files, binaries) { path ->
                if (path == "assets/textures/panel.png" || path == "originals/assets/textures/badge.png") null else sizes[path]
            }.map { it.path },
        )
    }

    @Test
    fun `an image at other measures is told with the measures of its original`() {
        val pngs = binaries.associateWith { path -> (sizes[path] ?: (8 to 8)).let { (w, h) -> Png.encode(RgbaImage(w, h)) } }
        val left = OwnerImages.otherMeasures(files.associate { it.path to it.content }, binaries) { pngs[it] }
        assertEquals(
            listOf(
                listOf("assets/textures/badge.png", "originals/assets/textures/badge.png", "hud", "12x12"),
                listOf("assets/glyphs/gem.png", "originals/assets/glyphs/gem.png", "glyph", "height 8, ascent 7"),
            ),
            left.map { listOf(it.path, it.original, it.function, it.measures) },
        )
    }

    @Test
    fun `the owner's composed image takes its name from the PNG the module ships`() {
        val recipe = "compose:\n  - image: window_layer\n"
        val files = listOf(
            PackFile("originals/assets/glyphs/window.yml", "ascent: 13\n"),
            PackFile("assets/glyphs/window.yml", "ascent: 13\n$recipe"),
            // A descriptor without a recipe changes what the shipped image says, and keeps its PNG.
            PackFile("assets/glyphs/icon.yml", "ascent: 9\n"),
            // A recipe the module ships beside its own PNG is no image: the PNG is.
            PackFile("originals/assets/glyphs/both.yml", recipe),
        )
        val binaries = listOf(
            "originals/assets/glyphs/window.png",
            "assets/glyphs/window_layer.png",
            "originals/assets/glyphs/icon.png",
            "originals/assets/glyphs/both.png",
        )
        val read = DiskAssets.fromTree("p", files, binaries, originals = true)
        assertEquals(
            listOf(
                listOf("window", "assets/glyphs/window.yml", true, 13.0),
                listOf("window_layer", "assets/glyphs/window_layer.png", false, null),
                listOf("both", "originals/assets/glyphs/both.png", false, null),
                listOf("icon", "originals/assets/glyphs/icon.png", false, 9.0),
            ),
            read.map { listOf(it.row.id, it.path, it.recipe != null, it.row.ascent) },
        )
    }

    @Test
    fun `the pack's read takes the owner's image at other measures than its original's`() {
        val read = DiskAssets.fromTree("p", files, binaries, originals = true)
        val at = read.associateBy { "${it.row.type}/${it.row.id}" }
        assertEquals("assets/textures/panel.png", at.getValue("texture/panel").path)
        assertEquals("assets/textures/badge.png", at.getValue("texture/badge").path)
        assertEquals("assets/textures/free.png", at.getValue("texture/free").path)
        assertEquals("assets/textures/mine.png", at.getValue("texture/mine").path)
        assertEquals("assets/glyphs/coin.png", at.getValue("glyph/coin").path)
        assertEquals("assets/glyphs/gem.png", at.getValue("glyph/gem").path)
        assertEquals(9.0, at.getValue("glyph/gem").row.ascent)
        assertEquals("assets/glyphs/star.png", at.getValue("glyph/star").path)
        assertEquals(7, read.size)
        // A read without originals leaves the owner's files.
        assertEquals(9.0, DiskAssets.fromTree("p", files, binaries).first { it.row.id == "gem" }.row.ascent)
    }
}
