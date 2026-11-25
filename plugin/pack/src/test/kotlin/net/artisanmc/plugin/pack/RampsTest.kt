package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The base's colour ramps: the declaration covers the base, and the shades are the editor's. */
class RampsTest {
    private fun hex(color: Int) = "#%06x".format(color)

    @Test
    fun `every colour of the base's images is in one ramp, and one only`() {
        val seen = HashSet<Int>()
        for (slot in Kit.slots) {
            val image = Png.decode(Kit.shipped(slot))
            for (i in 0 until image.width * image.height) {
                val at = i * 4
                if (image.data[at + 3].toInt() == 0) continue
                seen.add(((image.data[at].toInt() and 255) shl 16) or ((image.data[at + 1].toInt() and 255) shl 8) or (image.data[at + 2].toInt() and 255))
            }
        }
        val declared = Ramps.all.flatMap { it.shades }
        assertEquals(declared.size, declared.toSet().size)
        assertEquals(seen.map(::hex).sorted(), declared.map(::hex).sorted())
        assertEquals(listOf("primary", "danger", "accent", "neutral"), Ramps.all.map { it.id })
        for (ramp in Ramps.all) assertTrue(ramp.main in ramp.shades, ramp.id)
        assertNull(Ramps.ramp("absent"))
    }

    @Test
    fun `the shades are the ones the editor computes`() {
        val cases = ObjectMapper().readTree(File("../testdata/ramp-shades-conformance.json"))["cases"]
        assertTrue(cases.size() > 0)
        for (case in cases) {
            val ramp = Ramps.ramp(case["ramp"].asText())!!
            val picked = case["picked"].asText()
            val expected = case["table"].fields().asSequence().map { it.key to it.value.asText() }.toList()
            val computed = Ramps.table(ramp, picked.substring(1).toInt(16)).map { hex(it.key) to hex(it.value) }
            assertEquals(expected, computed, "${ramp.id} $picked")
        }
    }
}
