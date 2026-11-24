package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PixelArtTest {
    private val ground = 0x3a2852ff

    /** An image from rows of characters: `.` transparent, `_` the ground, else [palette]. */
    private fun art(vararg rows: String, palette: Map<Char, Int> = COLOURS): RgbaImage {
        val image = RgbaImage(rows[0].length, rows.size)
        rows.forEachIndexed { y, row ->
            row.forEachIndexed { x, key ->
                val rgba = when (key) { '.' -> 0; '_' -> ground; else -> palette.getValue(key) }
                java.nio.ByteBuffer.wrap(image.data, (y * image.width + x) * 4, 4).putInt(rgba)
            }
        }
        return image
    }

    /** [images] enlarged [scale] times on a picture of the ground, each at its place (in art pixels), the whole shifted by [shift]. */
    private fun picture(width: Int, height: Int, scale: Int, shift: Int, vararg images: Pair<RgbaImage, Pair<Int, Int>>): RgbaImage {
        val canvas = MenuPictures.Canvas(RgbaImage(width, height), 0, 0)
        canvas.fill(ground)
        for ((image, at) in images) canvas.draw(MenuPictures.enlarge(image, scale), shift + at.first * scale, shift + at.second * scale)
        return canvas.image
    }

    private fun rows(image: RgbaImage): List<String> = (0 until image.height).map { y ->
        (0 until image.width).joinToString("") { x -> "%08x".format(PixelArt.rgba(image, x, y)) }
    }

    // A round button: its corners show the ground.
    private val button = art(
        "_kkkkkk_",
        "kwwwwwgk",
        "kwrrrrgk",
        "kwrbbrgk",
        "kgggggGk",
        "_kkkkkk_",
    )
    private val icon = art(
        "r.r",
        ".r.",
        "r.r",
    )

    @Test
    fun `the art's pixel is found with where its cells start, and not in a picture at its own size`() {
        val shown = picture(120, 90, 4, 3, button to (5 to 4))
        val grid = assertNotNull(PixelArt.grid(shown, PixelRect(0, 0, 120, 90)))
        assertEquals(listOf(4, 3, 3), listOf(grid.size, grid.offsetX, grid.offsetY))
        // Twice as large, the same art has a pixel twice as large: the largest cell that explains the edges.
        assertEquals(6, PixelArt.grid(picture(180, 135, 6, 0, button to (5 to 4)), PixelRect(0, 0, 180, 135))?.size)
        // A plain part of it says nothing; what surrounds it does.
        assertNull(PixelArt.grid(shown, PixelRect(31, 31, 12, 4)))
        assertEquals(4, PixelArt.gridAround(shown, PixelRect(31, 31, 12, 4))?.size)
        assertNull(PixelArt.grid(picture(40, 30, 1, 0, button to (5 to 4)), PixelRect(0, 0, 40, 30)), "one picture pixel per art pixel")
        assertNull(PixelArt.grid(picture(40, 30, 4, 0), PixelRect(0, 0, 40, 30)), "nothing but the ground")
    }

    @Test
    fun `a rectangle comes back at one pixel per pixel of the art, from the cells it holds most of`() {
        val shown = picture(120, 90, 4, 3, button to (5 to 4))
        val grid = PixelArt.grid(shown, PixelRect(0, 0, 120, 90))!!
        // The button is at 23,19, 32 by 24: a rectangle a pixel or two off snaps to its cells.
        val rect = PixelArt.snap(PixelRect(24, 18, 31, 25), grid)
        assertEquals(PixelRect(23, 19, 32, 24), rect)
        assertEquals(rows(button), rows(PixelArt.reduce(shown, rect, rect.width / 4, rect.height / 4)))
        // A size that is not whole: the cells are read in their middle.
        assertEquals(rows(button), rows(PixelArt.reduce(shown, PixelRect(23, 19, 32, 24), 8, 6)))
    }

    @Test
    fun `the ground around an element goes, a neighbour the rectangle cut goes, the element stays whole`() {
        // The button with its ground around, and the corner of a neighbour at the right edge.
        val cut = art(
            "__________k",
            "__kkkkkk__k",
            "_kwwwwwgk__",
            "_kwrrrrgk__",
            "_kwrbbrgk__",
            "_kgggggGk__",
            "__kkkkkk___",
            "___________",
        )
        assertEquals(ground, PixelArt.edgeColour(cut))
        assertEquals(42, PixelArt.cutOut(cut, ground, 32, everywhere = false))
        val dropped = PixelArt.dropCut(cut)
        assertEquals(2 to false, dropped.pixels to dropped.keptAtEdge)
        val kept = assertNotNull(PixelArt.content(cut))
        assertEquals(PixelRect(1, 1, 8, 6), kept)
        val element = PixelArt.crop(cut, kept)
        assertEquals(0, element.alpha(0, 0), "a round corner is transparent")
        assertEquals(COLOURS.getValue('k'), PixelArt.rgba(element, 1, 0))

        // An element the rectangle cuts reaches its middle: it stays, and that is said.
        val through = art("_____", "kkkkk", "_____", "_____")
        PixelArt.cutOut(through, ground, 32, everywhere = false)
        assertTrue(PixelArt.dropCut(through).keptAtEdge)
        assertEquals(PixelRect(0, 1, 5, 1), PixelArt.content(through))

        // The hole of a frame goes only when asked everywhere.
        val frame = { art("____", "_kk_", "k__k", "_kk_", "____") }
        assertEquals(255, frame().also { PixelArt.cutOut(it, ground, 32, everywhere = false) }.alpha(1, 2))
        assertEquals(0, frame().also { PixelArt.cutOut(it, ground, 32, everywhere = true) }.alpha(1, 2))
        val motley = "abcdefgh".withIndex().associate { (i, key) -> key to (((i * 36) shl 24) or ((255 - i * 30) shl 16) or 0x40ff) }
        assertNull(PixelArt.edgeColour(art("abc", "d_e", "fgh", palette = motley)), "no colour holds the edge")
        assertEquals(0, PixelArt.edgeColour(icon), "already transparent")
    }

    @Test
    fun `close colours settle on the most frequent one, and an image keeps as few colours as asked`() {
        val noisy = art("aaab", "aaac", "kkkk", palette = mapOf('a' to 0xc6c6c6ff.toInt(), 'b' to 0xc8c4c9ff.toInt(), 'c' to 0xc0c0c0ff.toInt(), 'k' to 0x000000ff))
        assertEquals(2, PixelArt.settle(noisy, 30))
        assertEquals(0xc6c6c6ff.toInt(), PixelArt.rgba(noisy, 3, 0))
        assertEquals(0xc6c6c6ff.toInt(), PixelArt.rgba(noisy, 3, 1))

        val many = RgbaImage(16, 4)
        for (i in 0 until 64) java.nio.ByteBuffer.wrap(many.data, i * 4, 4).putInt(((i * 4) shl 24) or ((255 - i * 3) shl 16) or (if (i < 32) 0x10ff else 0xe0ff))
        many.data[3] = 0
        assertEquals(4, PixelArt.limit(many, 4))
        val left = (1 until 64).map { PixelArt.rgba(many, it % 16, it / 16) }.toSet()
        assertEquals(4, left.size)
        assertEquals(0, many.alpha(0, 0), "what is transparent stays so")
        assertEquals(2, PixelArt.limit(art("kkww"), 8), "fewer colours than asked: untouched")
    }

    @Test
    fun `the elements of a picture are told apart from its ground, in reading order`() {
        val shown = picture(150, 100, 5, 2, button to (2 to 2), icon to (20 to 3), button to (4 to 11))
        val grid = PixelArt.grid(shown, PixelRect(0, 0, 150, 100))!!
        val found = assertNotNull(PixelArt.elements(shown, PixelRect(0, 0, 150, 100), grid))
        assertEquals(ground, found.background)
        // The 3x3 icon is a speck: smaller than four art pixels.
        assertEquals(listOf(PixelRect(12, 12, 40, 30), PixelRect(22, 57, 40, 30)), found.rects)
        // A zone that cuts an element does not report it.
        assertEquals(listOf(PixelRect(12, 12, 40, 30)), PixelArt.elements(shown, PixelRect(0, 0, 150, 70), grid)?.rects)
        assertNull(PixelArt.elements(art("kwrb", "gGkw", "rbgG"), PixelRect(0, 0, 4, 3), null), "no ground")
    }

    @Test
    fun `a picture under its ruler is enlarged to be read, or shrunk to fit`() {
        val shown = picture(120, 90, 4, 3, button to (5 to 4))
        val view = ImageRulers.view(PixelRect(0, 0, 120, 90))
        assertEquals("x8", view.label)
        val ruled = ImageRulers.picture(shown, PixelRect(0, 0, 120, 90), listOf(PixelRect(23, 19, 32, 24)))
        assertEquals(listOf(52 + 120 * 8 + 4, 20 + 90 * 8 + 4), listOf(ruled.width, ruled.height))
        // Inside the button's first white pixel, eight picture pixels an image pixel, past the margins and off the lines.
        assertEquals(COLOURS.getValue('w'), PixelArt.rgba(ruled, 52 + (23 + 4) * 8 + 12, 20 + (19 + 4) * 8 + 12))
        assertContentEquals(listOf("1/2", "1/3", "x1"), listOf(1920, 2560, 960).map { ImageRulers.view(PixelRect(0, 0, it, 100)).label })
    }

    private companion object {
        val COLOURS = mapOf(
            'k' to 0x000000ff, 'w' to 0xffffffff.toInt(), 'r' to 0xc03030ff.toInt(), 'b' to 0x3050c0ff,
            'g' to 0x8b8b8bff.toInt(), 'G' to 0x555555ff,
        )
    }
}
