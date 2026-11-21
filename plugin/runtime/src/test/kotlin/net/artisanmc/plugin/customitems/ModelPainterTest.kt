package net.artisanmc.plugin.customitems

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import java.awt.image.BufferedImage
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ModelPainterTest {
    private val json = ObjectMapper()

    private fun plain(argb: Int, side: Int = 16) =
        BufferedImage(side, side, BufferedImage.TYPE_INT_ARGB).also { image -> for (y in 0 until side) for (x in 0 until side) image.setRGB(x, y, argb) }

    private val red = 0xffff0000.toInt()
    private val green = 0xff00ff00.toInt()
    private val blue = 0xff0000ff.toInt()

    private fun cube(vararg faces: Pair<String, String>, extra: String = "") =
        """[{"from":[0,0,0],"to":[16,16,16]$extra,"faces":{${faces.joinToString(",") { (face, texture) -> "\"$face\":{\"texture\":\"#$texture\"}" }}}}]"""

    private val allFaces = arrayOf("up" to "u", "down" to "d", "north" to "n", "south" to "s", "east" to "e", "west" to "w")
    private val textures = mapOf("u" to plain(red), "d" to plain(blue), "n" to plain(green), "s" to plain(blue), "e" to plain(green), "w" to plain(blue))

    private fun rgb(image: BufferedImage, x: Int, y: Int) = image.getRGB(x, y) and 0xffffff
    private fun alpha(image: BufferedImage, x: Int, y: Int) = image.getRGB(x, y) ushr 24

    @Test
    fun `a block with no display is seen from above its corner, its top unshaded`() {
        val image = assertNotNull(ModelPainter.paint(json.readTree(cube(*allFaces)), textures, null, null, 64))
        // The top is a lozenge in the upper half, at full brightness.
        assertEquals(0xff0000, rgb(image, 32, 20))
        // Two sides under it, each darker than its texture: the game's side shading.
        val left = rgb(image, 22, 42)
        val right = rgb(image, 42, 42)
        assertTrue(left != 0xff0000 && right != 0xff0000)
        assertTrue(left != right)
        assertTrue((left shr 16) == 0 && (right shr 16) == 0)
        // Nothing in the corners of the slot.
        assertEquals(0, alpha(image, 1, 1))
        assertEquals(0, alpha(image, 62, 62))
    }

    @Test
    fun `gui_light front and shade false leave every face at full brightness`() {
        val display = json.readTree("""{"rotation":[0,0,0]}""")
        val south = mapOf("s" to plain(green))
        val lit = assertNotNull(ModelPainter.paint(json.readTree(cube("south" to "s")), south, display, null, 16))
        assertEquals(0x00cc00, rgb(lit, 8, 8))
        val front = assertNotNull(ModelPainter.paint(json.readTree(cube("south" to "s")), south, display, "front", 16))
        assertEquals(0x00ff00, rgb(front, 8, 8))
        val unshaded = assertNotNull(ModelPainter.paint(json.readTree(cube("south" to "s", extra = ""","shade":false""")), south, display, null, 16))
        assertEquals(0x00ff00, rgb(unshaded, 8, 8))
    }

    @Test
    fun `a face shows the area of the texture its uv names, turned by its rotation`() {
        // Left half red, right half blue.
        val halves = BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB).also { image ->
            for (y in 0 until 16) for (x in 0 until 16) image.setRGB(x, y, if (x < 8) red else blue)
        }
        val display = json.readTree("""{"rotation":[0,0,0]}""")
        fun paint(face: String) = assertNotNull(
            ModelPainter.paint(json.readTree("""[{"from":[0,0,0],"to":[16,16,16],"faces":{"south":$face}}]"""), mapOf("t" to halves), display, "front", 16),
        )
        val whole = paint("""{"texture":"#t","uv":[0,0,16,16]}""")
        assertEquals(0xff0000, rgb(whole, 3, 8))
        assertEquals(0x0000ff, rgb(whole, 12, 8))
        val rightHalf = paint("""{"texture":"#t","uv":[8,0,16,16]}""")
        assertEquals(0x0000ff, rgb(rightHalf, 3, 8))
        // Turned a quarter clockwise: the texture's left side is now at the top.
        val turned = paint("""{"texture":"#t","uv":[0,0,16,16],"rotation":90}""")
        assertEquals(0xff0000, rgb(turned, 8, 3))
        assertEquals(0x0000ff, rgb(turned, 8, 12))
    }

    @Test
    fun `an element turns about its own origin`() {
        val display = json.readTree("""{"rotation":[0,0,0]}""")
        // A bar along the left edge, turned a quarter about the slot's centre: it lies along an edge at right angles.
        val bar = """[{"from":[0,0,7],"to":[2,16,9],"rotation":{"origin":[8,8,8],"axis":"z","angle":90},"faces":{"south":{"texture":"#t"}}}]"""
        val image = assertNotNull(ModelPainter.paint(json.readTree(bar), mapOf("t" to plain(red)), display, "front", 16))
        val filledRows = (0 until 16).filter { y -> (0 until 16).all { x -> alpha(image, x, y) == 255 } }
        assertEquals(2, filledRows.size)
        assertTrue(filledRows.all { it < 2 } || filledRows.all { it > 13 })
    }

    @Test
    fun `the nearer face hides the farther one, whatever the order of the elements`() {
        val display = json.readTree("""{"rotation":[0,0,0]}""")
        val near = """{"from":[0,0,10],"to":[16,16,12],"faces":{"south":{"texture":"#near"}}}"""
        val far = """{"from":[0,0,2],"to":[16,16,4],"faces":{"south":{"texture":"#far"}}}"""
        val both = mapOf("near" to plain(red), "far" to plain(blue))
        for (elements in listOf("[$near,$far]", "[$far,$near]")) {
            val image = assertNotNull(ModelPainter.paint(json.readTree(elements), both, display, "front", 16))
            assertEquals(0xff0000, rgb(image, 8, 8))
        }
    }

    @Test
    fun `a transparent texel lets what is behind show, and an empty model gives nothing`() {
        val display = json.readTree("""{"rotation":[0,0,0]}""")
        val near = """{"from":[0,0,10],"to":[16,16,12],"faces":{"south":{"texture":"#near"}}}"""
        val far = """{"from":[0,0,2],"to":[16,16,4],"faces":{"south":{"texture":"#far"}}}"""
        val image = assertNotNull(ModelPainter.paint(json.readTree("[$near,$far]"), mapOf("near" to plain(0), "far" to plain(blue)), display, "front", 16))
        assertEquals(0x0000ff, rgb(image, 8, 8))
        assertNull(ModelPainter.paint(json.readTree("[$near]"), mapOf("near" to plain(0)), display, "front", 16))
        // A face naming a texture the model does not have, an element without faces: skipped.
        assertNull(ModelPainter.paint(json.readTree("""[{"from":[0,0,0],"to":[16,16,16]},{"from":[0,0,0],"to":[1,1,1],"faces":{"up":{"texture":"#nowhere"}}}]"""), both(), display, null, 16))
    }

    private fun both() = mapOf("near" to plain(red))
}
