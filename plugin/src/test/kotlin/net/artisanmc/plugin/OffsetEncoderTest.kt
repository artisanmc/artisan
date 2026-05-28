package net.artisanmc.plugin

import net.artisanmc.plugin.render.OffsetEncoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OffsetEncoderTest {

    /** Standard table mirroring `backend/src/lib/spaceOffsets.ts`. */
    private val standardMap: Map<Int, Int> = run {
        val advances = listOf(1, 2, 4, 8, 16, 32, 64, 128, 256, -1, -2, -4, -8, -16, -32, -64, -128, -256)
        advances.mapIndexed { i, adv -> (0xF800 + i) to adv }.toMap()
    }
    private val byChar: Map<Char, Int> = standardMap.mapKeys { it.key.toChar() }

    /** Decode helper: sum the advances of [s] using the standard map. */
    private fun decode(s: String): Int = s.sumOf { ch -> byChar[ch] ?: error("unknown char ${ch.code.toString(16)}") }

    @Test
    fun `encode 0 returns empty string`() {
        val enc = OffsetEncoder.from(standardMap)
        assertEquals("", enc.encode(0))
    }

    @Test
    fun `encode 7 decodes back to 7`() {
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(7)
        assertEquals(7, decode(out))
        assertEquals(3, out.length) // 4 + 2 + 1
    }

    @Test
    fun `encode -115 decodes back to -115`() {
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(-115)
        assertEquals(-115, decode(out))
    }

    @Test
    fun `encode 500 decodes back to 500`() {
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(500)
        assertEquals(500, decode(out))
    }

    @Test
    fun `encode 511 hits exact upper bound`() {
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(511)
        assertEquals(511, decode(out))
        assertEquals(9, out.length)
    }

    @Test
    fun `encode -511 hits exact lower bound`() {
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(-511)
        assertEquals(-511, decode(out))
    }

    @Test
    fun `large positive offsets reuse chars to decompose exactly`() {
        // Greedy reuse of same-sign chars means there's no hard upper limit:
        // 1000 = 256+256+256+128+64+32+8 decomposes exactly via reuse.
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(1000)
        assertEquals(1000, decode(out))
    }

    @Test
    fun `large negative offsets reuse chars to decompose exactly`() {
        val enc = OffsetEncoder.from(standardMap)
        val out = enc.encode(-1000)
        assertEquals(-1000, decode(out))
    }

    @Test
    fun `empty offset map returns empty string for any input`() {
        val enc = OffsetEncoder.from(emptyMap())
        assertEquals("", enc.encode(7))
        assertEquals("", enc.encode(0))
        assertEquals("", enc.encode(-5))
        assertEquals(0, enc.maxPositive)
        assertEquals(0, enc.maxNegative)
    }

    @Test
    fun `EMPTY constant behaves like an empty-map encoder`() {
        assertEquals("", OffsetEncoder.EMPTY.encode(10))
        assertEquals("", OffsetEncoder.EMPTY.encode(0))
    }

    @Test
    fun `round-trip across a range of values`() {
        val enc = OffsetEncoder.from(standardMap)
        for (n in listOf(1, -1, 8, -8, 100, -100, 255, -255, 300, -333, 511, -511)) {
            assertEquals(n, decode(enc.encode(n)), "round-trip failed for $n")
        }
    }

    @Test
    fun `from with single small advance produces only allowed chars`() {
        // Encoder with only +1 and -1 advances.
        val plusCp = 0xF800
        val minusCp = 0xF809
        val enc = OffsetEncoder.from(mapOf(plusCp to 1, minusCp to -1))
        val plus3 = enc.encode(3)
        assertEquals(3, plus3.length)
        plus3.forEach { assertEquals(plusCp, it.code) }
        val minus2 = enc.encode(-2)
        assertEquals(2, minus2.length)
        minus2.forEach { assertEquals(minusCp, it.code) }
        assertEquals("", enc.encode(0))
    }

    @Test
    fun `maxPositive and maxNegative reflect supplied table`() {
        val enc = OffsetEncoder.from(standardMap)
        assertEquals(511, enc.maxPositive)
        assertEquals(-511, enc.maxNegative)
    }
}
