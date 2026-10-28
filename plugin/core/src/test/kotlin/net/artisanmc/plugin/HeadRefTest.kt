package net.artisanmc.plugin

import net.artisanmc.plugin.render.HeadRef
import kotlin.test.*

class HeadRefTest {
    @Test fun `parses hdb ids`() {
        assertEquals(HeadRef.Hdb("128276"), HeadRef.parse("hdb:128276"))
    }

    @Test fun `parses basehead base64`() {
        assertEquals(HeadRef.Base64("eyJ0ZXh0dXJlcyI6e319"), HeadRef.parse("basehead:eyJ0ZXh0dXJlcyI6e319"))
    }

    @Test fun `parses playerhead names`() {
        assertEquals(HeadRef.PlayerName("Notch"), HeadRef.parse("playerhead:Notch"))
    }

    @Test fun `raw base64 without prefix is tolerated (hand-edited YAML)`() {
        assertEquals(HeadRef.Base64("eyJ0ZXh0dXJlcyI6e319"), HeadRef.parse("eyJ0ZXh0dXJlcyI6e319"))
    }

    @Test fun `unknown values and empty payloads parse to null`() {
        assertNull(HeadRef.parse("wat:123"))
        assertNull(HeadRef.parse("hdb:"))
        assertNull(HeadRef.parse("playerhead: "))
        assertNull(HeadRef.parse(""))
    }

    @Test fun `uuidFor is deterministic`() {
        assertEquals(HeadRef.uuidFor("eyJabc"), HeadRef.uuidFor("eyJabc"))
        assertNotEquals(HeadRef.uuidFor("eyJabc"), HeadRef.uuidFor("eyJxyz"))
    }
}
