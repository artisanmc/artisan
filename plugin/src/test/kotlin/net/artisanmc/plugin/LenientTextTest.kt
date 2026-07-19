package net.artisanmc.plugin

import net.artisanmc.plugin.render.LenientText
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * User text parsing must NEVER throw: migrated prod data is full of legacy
 * `§` codes, and MiniMessage hard-rejects them (a single `§7Retour` title
 * used to cancel the whole InventoryClickEvent). Legacy codes convert to
 * their MiniMessage equivalent; anything unparseable degrades to plain text.
 */
class LenientTextTest {
    private val plain = PlainTextComponentSerializer.plainText()

    @Test
    fun `legacy section codes render instead of throwing`() {
        val c = LenientText.parse("§7Retour")
        assertEquals("Retour", plain.serialize(c))
    }

    @Test
    fun `minimessage strings still parse normally`() {
        val c = LenientText.parse("<gray>Retour</gray>")
        assertEquals("Retour", plain.serialize(c))
    }

    @Test
    fun `legacy hex and mixed content keep their text`() {
        val c = LenientText.parse("§ePrix : 100 §6tokens")
        assertEquals("Prix : 100 tokens", plain.serialize(c))
    }

    @Test
    fun `legacyToMini converts codes and is identity without them`() {
        assertEquals("plain", LenientText.legacyToMini("plain"))
        assertTrue(LenientText.legacyToMini("§7Retour").contains("Retour"))
        assertTrue(!LenientText.legacyToMini("§7Retour").contains("§"))
    }

    @Test
    fun `malformed minimessage degrades to plain text instead of throwing`() {
        val c = LenientText.parse("<gradient:oops")
        // Whatever the exact rendering, it must not throw and must keep content.
        assertTrue(plain.serialize(c).isNotEmpty())
    }
}
