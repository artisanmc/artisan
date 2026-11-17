package net.artisanmc.plugin.stats

import kotlin.test.Test
import kotlin.test.assertEquals

class DimensionsTest {
    @Test
    fun `keys are sorted so equal dimensions are equal strings`() {
        assertEquals("menu=shop&result=ok", Dimensions.encode(mapOf("result" to "ok", "menu" to "shop")))
        assertEquals("", Dimensions.encode(emptyMap()))
    }

    @Test
    fun `separators and percent are escaped and decoded back`() {
        val dims = mapOf("item" to "a&b=c%d", "menu" to "boutique/armes")
        val encoded = Dimensions.encode(dims)
        assertEquals("item=a%26b%3Dc%25d&menu=boutique/armes", encoded)
        assertEquals(dims, Dimensions.decode(encoded))
        assertEquals(emptyMap(), Dimensions.decode(""))
    }

    @Test
    fun `details become a JSON object with escaped strings`() {
        assertEquals("{}", Dimensions.json(emptyMap()))
        assertEquals("""{"a":"x\"y","b":"line\nnext\\"}""", Dimensions.json(mapOf("b" to "line\nnext\\", "a" to "x\"y")))
    }
}
