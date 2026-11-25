package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KitTest {
    private fun png(width: Int, height: Int) = Png.encode(RgbaImage(width, height).also { it.data.fill(0x7f) })

    @Test
    fun `every slot of the base ships an image of its size`() {
        assertEquals(19, Kit.slots.size)
        assertEquals(Kit.slots.size, Kit.slots.map { it.id }.toSet().size)
        for (slot in Kit.slots) {
            val image = Png.decode(Kit.shipped(slot))
            assertEquals("${slot.id} ${slot.width}x${slot.height}", "${slot.id} ${image.width}x${image.height}")
        }
    }

    @Test
    fun `the kit module's image wins at the base's size, the base's stays at another`() {
        val own = png(16, 16)
        assertFalse(Kit.image("close.1x1", own)!!.shipped)
        assertTrue(Kit.image("close.1x1", own)!!.png === own)
        val wrong = Kit.image("close.1x1", png(10, 10))!!
        assertTrue(wrong.shipped)
        assertEquals(16 to 16, wrong.width to wrong.height)
        assertTrue(Kit.image("close.1x1", byteArrayOf(1, 2, 3))!!.shipped)
        assertTrue(Kit.image("close.1x1", null)!!.shipped)
    }

    @Test
    fun `a name outside the base is the kit module's own image, or nothing`() {
        val banner = Kit.image("banner", png(20, 12))!!
        assertEquals(20 to 12, banner.width to banner.height)
        assertNull(Kit.image("banner", null))
        assertNull(Kit.image("banner", byteArrayOf(1, 2, 3)))
    }

    @Test
    fun `the base is the one the server holds, when it holds one`() {
        val held = png(20, 12)
        // Another version of Artisan's than this builder's: its size is the one a redraw has to match.
        assertTrue(Kit.image("close.1x1", null, held)!!.let { it.png === held && it.shipped })
        val own = png(20, 12)
        assertTrue(Kit.image("close.1x1", own, held)!!.let { it.png === own && !it.shipped })
        assertTrue(Kit.image("close.1x1", png(16, 16), held)!!.png === held)
        assertTrue(Kit.image("later", null, held)!!.png === held)
        assertEquals(16, Kit.image("close.1x1", null, byteArrayOf(1))!!.width)
    }

    @Test
    fun `the common images are the theme artisan's, the ui-kit module's on a server without it`() {
        assertEquals("artisan", Kit.folderAmong(listOf("shop", "artisan", "ui-kit")))
        assertEquals("ui-kit", Kit.folderAmong(listOf("shop", "ui-kit")))
        assertEquals("artisan", Kit.folderAmong(listOf("shop")))
        assertEquals("originals/assets/textures/button.3x1.png", Kit.shippedPath("button.3x1"))
        assertEquals("button.3x1", Kit.shippedName("originals/assets/textures/button.3x1.png"))
        assertNull(Kit.shippedName("assets/textures/button.3x1.png"))
        assertNull(Kit.shippedName("originals/assets/textures/sub/x.png"))
        assertNull(Kit.shippedName("originals/assets/textures/x.yml"))
    }

    @Test
    fun `only a name after the prefix is a kit image`() {
        assertEquals("button.3x1", Kit.nameOf("kit:button.3x1"))
        assertEquals("button.3x1", Kit.nameOf("artisan:button.3x1"))
        assertNull(Kit.nameOf("artisan:"))
        assertNull(Kit.nameOf("kit:"))
        assertNull(Kit.nameOf("button"))
        assertNull(Kit.nameOf("my_kit:button"))
    }
}
