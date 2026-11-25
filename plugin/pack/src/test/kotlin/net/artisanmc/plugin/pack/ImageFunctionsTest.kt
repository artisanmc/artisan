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
    fun `the owner's image at other measures than its original's is not taken`() {
        assertEquals(
            listOf("assets/textures/badge.png", "assets/glyphs/gem.png"),
            ImageFunctions.refused(files, binaries) { sizes[it] }.map { it.path },
        )
        // Without the pixels, a menu or HUD image is taken; a glyph is still measured.
        assertEquals(listOf("assets/glyphs/gem.png"), ImageFunctions.refused(files, binaries, null).map { it.path })
        // An owner's file that is no image is not taken; an original that is none measures nothing.
        assertEquals(
            listOf("assets/textures/panel.png", "assets/glyphs/gem.png"),
            ImageFunctions.refused(files, binaries) { path ->
                if (path == "assets/textures/panel.png" || path == "originals/assets/textures/badge.png") null else sizes[path]
            }.map { it.path },
        )
    }

    @Test
    fun `the pack's read shows the original, descriptor included, in place of an image not taken`() {
        val read = DiskAssets.fromTree("p", files, binaries, originals = true) { sizes[it] }
        val at = read.associateBy { "${it.row.type}/${it.row.id}" }
        assertEquals("assets/textures/panel.png", at.getValue("texture/panel").path)
        assertEquals("originals/assets/textures/badge.png", at.getValue("texture/badge").path)
        assertEquals("assets/textures/free.png", at.getValue("texture/free").path)
        assertEquals("assets/textures/mine.png", at.getValue("texture/mine").path)
        assertEquals("assets/glyphs/coin.png", at.getValue("glyph/coin").path)
        assertEquals("originals/assets/glyphs/gem.png", at.getValue("glyph/gem").path)
        assertEquals(7.0, at.getValue("glyph/gem").row.ascent)
        assertEquals("assets/glyphs/star.png", at.getValue("glyph/star").path)
        assertEquals(7, read.size)
        // A read without originals leaves the owner's files.
        assertEquals(9.0, DiskAssets.fromTree("p", files, binaries).first { it.row.id == "gem" }.row.ascent)
    }
}
