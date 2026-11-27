package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ComposeTest {
    private fun solid(width: Int, height: Int, vararg rgba: Int) = RgbaImage(width, height).also {
        for (i in it.data.indices) it.data[i] = rgba[i % 4].toByte()
    }

    private fun pixel(image: RgbaImage, x: Int, y: Int) = (0..3).map { image.data[(y * image.width + x) * 4 + it].toInt() and 0xff }

    private fun recipe(yaml: String) = assertNotNull(ComposedImages.read(yaml))

    @Test
    fun `a descriptor without a compose list describes a PNG`() {
        assertNull(ComposedImages.read("width: 16\nheight: 16\n"))
        assertNull(ComposedImages.read("compose: 3\n"))
        assertNull(ComposedImages.read("- a list\n"))
        assertNull(ComposedImages.read("compose: [unclosed\n"))
        assertEquals(0, recipe("compose: []\n").layers.size)
    }

    @Test
    fun `layers are read with their place, and only a grid repeats`() {
        val read = recipe(
            """
            compose:
              - use: "kit:window.6"
              - image: icon
                x: 19
                y: -4
                columns: 5
              - grid: cell
                x: 7
                columns: 9
                rows: 4
              - grid: cell
                columns: 0
                rows: 65
              - grid: cell
                use: icon
                columns: 4
              - just text
              - image: ""
              - image: icon
                x: 1.5
                y: 900
            """.trimIndent(),
        )
        assertEquals(
            listOf("kit:window.6 0 0 1x1", "icon 19 -4 1x1", "cell 7 0 9x4", "cell 0 0 1x1", "icon 0 0 1x1", "icon 0 0 1x1"),
            read.layers.map { "${it.image} ${it.x} ${it.y} ${it.columns}x${it.rows}" },
        )
        assertNull(read.width)
    }

    @Test
    fun `a size is given by both sides or not at all`() {
        assertEquals(20 to 10, recipe("width: 20\nheight: 10\ncompose: []\n").let { it.width to it.height })
        assertEquals(null to null, recipe("width: 20\ncompose: []\n").let { it.width to it.height })
        assertEquals(null to null, recipe("width: 20\nheight: 513\ncompose: []\n").let { it.width to it.height })
        assertEquals(64, recipe("compose:\n" + "  - image: a\n".repeat(70)).layers.size)
    }

    @Test
    fun `the image is as large as its first drawn layer reaches, later layers are clipped`() {
        val images = mapOf("red" to solid(4, 3, 255, 0, 0, 255), "blue" to solid(2, 2, 0, 0, 255, 255))
        val out = assertNotNull(
            ComposedImages.compose(recipe("compose:\n  - image: gone\n  - grid: red\n    x: 1\n    y: 2\n    columns: 2\n  - image: blue\n    x: 8\n    y: 4\n")) { images[it] },
        )
        assertEquals(9 to 5, out.width to out.height)
        assertEquals(listOf(0, 0, 0, 0), pixel(out, 0, 0))
        assertEquals(listOf(255, 0, 0, 255), pixel(out, 1, 2))
        assertEquals(listOf(255, 0, 0, 255), pixel(out, 7, 3))
        assertEquals(listOf(0, 0, 255, 255), pixel(out, 8, 4))
    }

    @Test
    fun `a given size clips every layer, and nothing drawn is no image`() {
        val images = mapOf("red" to solid(4, 3, 255, 0, 0, 255))
        val out = assertNotNull(ComposedImages.compose(recipe("width: 2\nheight: 2\ncompose:\n  - image: red\n    x: -3\n    y: -2\n")) { images[it] })
        assertEquals(2 to 2, out.width to out.height)
        assertEquals(listOf(255, 0, 0, 255), pixel(out, 0, 0))
        assertEquals(listOf(0, 0, 0, 0), pixel(out, 1, 0))
        assertEquals(listOf(0, 0, 0, 0), pixel(out, 0, 1))
        assertNull(ComposedImages.compose(recipe("compose:\n  - image: gone\n")) { images[it] })
        assertNull(ComposedImages.compose(recipe("compose: []\n")) { images[it] })
    }

    @Test
    fun `a translucent pixel blends over what is under it, in whole numbers`() {
        val opaque = solid(1, 1, 0, 0, 255, 255)
        ComposedImages.over(opaque, solid(1, 1, 200, 100, 0, 128), 0, 0)
        assertEquals(listOf(100, 50, 127, 255), pixel(opaque, 0, 0))
        val veil = solid(1, 1, 0, 255, 0, 128)
        ComposedImages.over(veil, solid(1, 1, 255, 0, 0, 128), 0, 0)
        assertEquals(listOf(170, 85, 0, 192), pixel(veil, 0, 0))
        val kept = solid(1, 1, 1, 2, 3, 4)
        ComposedImages.over(kept, solid(1, 1, 9, 9, 9, 0), 0, 0)
        assertEquals(listOf(1, 2, 3, 4), pixel(kept, 0, 0))
        val empty = solid(1, 1, 7, 7, 7, 0)
        ComposedImages.over(empty, solid(1, 1, 9, 8, 7, 60), 0, 0)
        assertEquals(listOf(9, 8, 7, 60), pixel(empty, 0, 0))
    }

    @Test
    fun `a tint multiplies the layer's pixels by its colour, alpha kept, and only a colour tints`() {
        val grey = mapOf("grey" to solid(1, 1, 255, 128, 0, 200))
        val drawn = assertNotNull(ComposedImages.compose(recipe("compose:\n  - image: grey\n    tint: '#c03366'\n")) { grey[it] })
        assertEquals(listOf(192, 26, 0, 200), pixel(drawn, 0, 0))
        for (tint in listOf("primary", "#fff", "c03366", "#c0336g")) {
            assertNull(ComposedImages.tintColour(tint))
            val plain = assertNotNull(ComposedImages.compose(recipe("compose:\n  - image: grey\n    tint: '$tint'\n")) { grey[it] })
            assertEquals(listOf(255, 128, 0, 200), pixel(plain, 0, 0))
        }
        // A name is a colour once a palette gives it one.
        val palette = Palette.of(listOf("primary: \"#c03366\"\n"))
        val byName = assertNotNull(ComposedImages.compose(recipe("compose:\n  - image: grey\n    tint: primary\n"), palette = palette) { grey[it] })
        assertEquals(listOf(192, 26, 0, 200), pixel(byName, 0, 0))
        val unknown = assertNotNull(ComposedImages.compose(recipe("compose:\n  - image: grey\n    tint: nowhere\n"), palette = palette) { grey[it] })
        assertEquals(listOf(255, 128, 0, 200), pixel(unknown, 0, 0))
    }

    @Test
    fun `a layer is a PNG of the module or a kit image, the base standing in`() {
        val icon = Png.encode(solid(2, 2, 255, 255, 255, 255))
        val out = assertNotNull(
            ComposedImages.render(recipe("compose:\n  - use: \"kit:close.1x1\"\n  - image: icon\n  - image: broken\n"), { mapOf("icon" to icon, "broken" to byteArrayOf(1))[it] }, { Kit.image(it, null)?.png }),
        )
        assertEquals(16 to 16, out.width to out.height)
        assertEquals(listOf(255, 255, 255, 255), pixel(out, 1, 1))
        val own = Png.encode(solid(16, 16, 1, 2, 3, 255))
        val restyled = assertNotNull(ComposedImages.render(recipe("compose:\n  - use: \"kit:close.1x1\"\n"), { null }, { Kit.image(it, own.takeIf { _ -> it == "close.1x1" })?.png }))
        assertEquals(listOf(1, 2, 3, 255), pixel(restyled, 5, 5))
    }
}
