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
        assertEquals(23, Kit.slots.size)
        assertEquals(Kit.slots.size, Kit.slots.map { it.id }.toSet().size)
        for (slot in Kit.slots) {
            val image = Png.decode(Kit.shipped(slot))
            assertEquals("${slot.id} ${slot.width}x${slot.height}", "${slot.id} ${image.width}x${image.height}")
        }
    }

    @Test
    fun `a coloured variant ships its neutral image in the default palette's colour, and is redrawn in the server's`() {
        val variants = Kit.slots.filter { it.tint != null }
        assertEquals(listOf("button.primary.3x1", "button.success.3x1", "button.warning.3x1"), variants.map { it.id })
        val default = Palette.of(emptyList())
        for (slot in variants) {
            val of = Kit.slot(slot.tint!!.of)!!
            assertNull(of.tint)
            assertEquals(listOf(of.width, of.height), listOf(slot.width, slot.height))
            val shipped = Kit.image(slot.id, null)!!
            val drawn = Kit.tinted(slot.id, shipped, default) { Kit.shipped(Kit.slot(it)!!) }
            assertTrue(Png.decode(Kit.shipped(slot)).data.contentEquals(Png.decode(drawn.png).data), slot.id)
        }
        // In another palette, over the neutral image the server shows; the server's own image and a plain slot stay.
        val white = Png.encode(RgbaImage(2, 1).also { it.data.fill(0xff.toByte()) })
        val red = Kit.tinted("button.primary.3x1", Kit.image("button.primary.3x1", null)!!, Palette.of(listOf("primary: \"#b3261e\"\n"))) { white }
        assertEquals(listOf(2, 1, true), listOf(red.width, red.height, red.shipped))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 0xff), Png.decode(red.png).data.take(4).map { it.toInt() and 0xff })
        val own = Kit.image("button.primary.3x1", png(54, 18))!!
        assertTrue(Kit.tinted("button.primary.3x1", own, default) { white } === own)
        val plain = Kit.image("button.3x1", null)!!
        assertTrue(Kit.tinted("button.3x1", plain, default) { white } === plain)
        assertTrue(Kit.tinted("button.primary.3x1", Kit.image("button.primary.3x1", null)!!, default) { null }.shipped)
    }

    @Test
    fun `every component of the base reads, and draws base images only`() {
        assertEquals(setOf("button", "cancel", "confirm", "value"), Kit.components.keys)
        for ((name, text) in Kit.components) {
            val file = Yaml.parse(text) as Map<*, *>
            val params = file["params"] as? Map<*, *> ?: emptyMap<Any?, Any?>()
            val parts = file["parts"] as List<*>
            assertTrue(parts.isNotEmpty(), name)
            // Every look the component can take without an image of the menu's: each choice's names.
            val looks = listOf(emptyMap<String, String>()) + params.entries.flatMap { (param, spec) ->
                val values = (spec as? Map<*, *>)?.takeIf { it["type"] == "choice" }?.get("values")
                ((values as? Map<*, *>)?.keys ?: values as? List<*> ?: emptyList<Any?>()).map { mapOf(param as String to it as String) }
            }
            for (look in looks) {
                for (part in Components.parts(Components.Found(file, ""), look)) {
                    val drawn = (part as Map<*, *>)["image"] as? String ?: continue
                    assertTrue(Kit.slot(drawn) != null, "$name draws $drawn, which the base does not ship")
                }
            }
        }
    }

    @Test
    fun `a menu names a base component, and the server's own of that name replaces it`() {
        val shipped = Kit.components.map { (name, text) -> PackFile("originals/components/$name.yml", text) }
        val menu = mapOf("id" to "m", "size" to 27, "elements" to listOf(mapOf("id" to "ok", "positions" to "0-2", "component" to "confirm")))
        fun parts(theme: List<PackFile>): Any? {
            val expanded = Components.ofProjects(listOf("shop" to emptyList(), Kit.FOLDER to theme))("shop")(menu) as Map<*, *>
            return ((expanded["elements"] as List<*>)[0] as Map<*, *>)["parts"]
        }
        assertEquals(
            listOf(mapOf("image" to "artisan:button.3x1"), mapOf("label" to mapOf("en" to "Confirm", "fr" to "Confirmer"))),
            parts(shipped),
        )
        val own = PackFile("components/confirm.yml", "parts:\n  - image: my_button\n")
        assertEquals(listOf(mapOf("image" to "artisan:my_button")), parts(shipped + own))
    }

    @Test
    fun `the kit module's image wins at any size, the base's stays when it is unreadable`() {
        val own = png(16, 16)
        assertFalse(Kit.image("close.1x1", own)!!.shipped)
        assertTrue(Kit.image("close.1x1", own)!!.png === own)
        val other = Kit.image("close.1x1", png(10, 10))!!
        assertFalse(other.shipped)
        assertEquals(10 to 10, other.width to other.height)
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
        // Another version of Artisan's than this builder's.
        assertTrue(Kit.image("close.1x1", null, held)!!.let { it.png === held && it.shipped })
        val own = png(20, 12)
        assertTrue(Kit.image("close.1x1", own, held)!!.let { it.png === own && !it.shipped })
        val sized = png(16, 16)
        assertTrue(Kit.image("close.1x1", sized, held)!!.png === sized)
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
