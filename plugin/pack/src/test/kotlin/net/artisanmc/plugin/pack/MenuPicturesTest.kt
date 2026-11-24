package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** A menu drawn as a picture ([MenuPictures]): where each thing lands, and what the notes own up to. */
class MenuPicturesTest {
    private fun solid(width: Int, height: Int, rgb: Int): ByteArray {
        val image = RgbaImage(width, height)
        for (i in 0 until width * height) {
            image.data[i * 4] = (rgb shr 16).toByte()
            image.data[i * 4 + 1] = (rgb shr 8).toByte()
            image.data[i * 4 + 2] = rgb.toByte()
            image.data[i * 4 + 3] = 0xff.toByte()
        }
        return Png.encode(image)
    }

    private val images = mapOf(
        "shop_window" to MenuPictureImage(solid(176, 166, 0x102030), ascent = 13.0),
        "buy_button" to MenuPictureImage(solid(54, 18, 0x20c040)),
    )

    private fun render(menu: String, items: Map<String, ByteArray> = emptyMap()) =
        MenuPictures.render(MenuPictureInput(menu.trimIndent(), images::get, items::get))

    /** The colour at window ([x], [y]), as 0xRRGGBB. */
    private fun MenuPicture.at(x: Int, y: Int): Int {
        val i = ((y + windowY) * image.width + x + windowX) * 4
        return ((image.data[i].toInt() and 0xff) shl 16) or ((image.data[i + 1].toInt() and 0xff) shl 8) or (image.data[i + 2].toInt() and 0xff)
    }

    @Test
    fun `a textured menu shows its background, its button over its slots, its label and its item`() {
        val picture = render(
            """
            schema: menu/v1
            size: 27
            vanilla_texture: false
            title:
              - kind: background
                asset: shop_window
              - kind: text
                value: "Shop"
                x: 8
                y: 6
                color: "#ffffff"
            layers:
              - id: main
                elements:
                  - id: buy
                    positions: "12-14"
                    image: { asset: buy_button }
                    label: { text: "<white>Buy" }
                  - id: gem
                    positions: "0"
                    material: DIAMOND
                    count: 3
                  - id: reward
                    positions: "8"
                    material: "{r.material}"
                    states:
                      - if: ["{r.done}"]
                        material: BARRIER
            """,
            items = mapOf("diamond" to solid(32, 32, 0x40e0ff)),
        )
        assertEquals(listOf(176, 113 + 3 * 18), listOf(picture.windowWidth, picture.windowHeight))
        assertEquals(0x102030, picture.at(100, 100), "the background image, from the window's corner")
        assertEquals(0x26262a, picture.at(-5, 0), "the backdrop around the window")
        // Slots 12 to 14: the second row, columns 3 to 5.
        assertEquals(0x20c040, picture.at(7 + 3 * 18 + 1, 17 + 18 + 1))
        assertEquals(0x20c040, picture.at(7 + 6 * 18 - 2, 17 + 2 * 18 - 2))
        assertEquals(0x102030, picture.at(7 + 6 * 18 + 1, 17 + 18 + 1), "no further than its slots")
        // The label is white, centred on the button; the title too, at its place.
        val row = (7 + 3 * 18 until 7 + 6 * 18).map { picture.at(it, 17 + 18 + 8) }
        assertTrue(0xffffff in row, "the label's pixels")
        assertTrue((8 until 40).any { x -> (6 until 14).any { y -> picture.at(x, y) == 0xffffff } }, "the title's text")
        // The item, scaled to the slot; its count over it.
        assertEquals(0x40e0ff, picture.at(8 + 2, 18 + 2))
        assertTrue((8 until 24).any { picture.at(it, 18 + 12) == 0xffffff }, "the count")
        // A slot whose item is an expression shows `?`, and the notes say so.
        assertNotEquals(0x102030, picture.at(7 + 8 * 18 + 8, 18 + 8))
        assertTrue(picture.notes.any { "`?`" in it })
        assertTrue(picture.notes.any { "states" in it })
    }

    @Test
    fun `a plain menu shows the vanilla window, and says which image and which item it lacks`() {
        val picture = render(
            """
            size: 54
            title: "Coffre"
            elements:
              - positions: "4"
                material: NOT_AN_ITEM
              - positions: "10"
                image: { asset: missing_button }
            """,
        )
        assertEquals(113 + 6 * 18, picture.windowHeight)
        assertEquals(0xc6c6c6, picture.at(88, 10), "the vanilla window's grey")
        assertEquals(0x8b8b8b, picture.at(7 + 9 + 18, 17 + 9 + 2 * 18), "an empty slot")
        assertTrue((8 until 50).any { x -> (6 until 14).any { y -> picture.at(x, y) == 0x404040 } }, "the title, in the game's dark grey")
        assertTrue(picture.notes.any { "missing_button" in it })
        assertTrue(picture.notes.any { "not_an_item" in it })
    }

    @Test
    fun `a file that is not a menu is refused`() {
        assertFailsWith<IllegalArgumentException> { render("- just\n- a list") }
    }
}
