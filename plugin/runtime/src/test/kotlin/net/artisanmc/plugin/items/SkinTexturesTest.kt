package net.artisanmc.plugin.items

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SkinTexturesTest {
    private val url = "http://textures.minecraft.net/texture/20732e7fb4694c6777948d3bfa3d02b3d5c15ccb1ca2eace9dbc2d6283b41bf1"

    @Test fun `reads the skin URL of a value`() {
        val value = Base64.getEncoder().encodeToString(
            """{"timestamp":1,"profileId":"x","textures":{"SKIN":{"url":"$url"}}}""".toByteArray(),
        )
        assertEquals(url, SkinTextures.skinUrl(value))
    }

    @Test fun `an encoded URL reads back the same`() {
        assertEquals(url, SkinTextures.skinUrl(SkinTextures.encode(url)))
    }

    @Test fun `a value without skin or not base64 has no URL`() {
        assertNull(SkinTextures.skinUrl("eyJ0ZXh0dXJlcyI6e319"))
        assertNull(SkinTextures.skinUrl("not base64 !"))
    }
}
