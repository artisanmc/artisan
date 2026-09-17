package net.artisanmc.plugin

import net.artisanmc.plugin.items.LegacyInternalTag
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.GZIPOutputStream

class LegacyInternalTagTest {

    private fun gzippedBase64(payload: String): String {
        val bytes = ByteArrayOutputStream()
        GZIPOutputStream(bytes).use { it.write(payload.toByteArray()) }
        return Base64.getEncoder().encodeToString(bytes.toByteArray())
    }

    private fun wrapped(internal: String) = """
        item:
          ==: org.bukkit.inventory.ItemStack
          v: 1
          type: SHULKER_BOX
          amount: 1
          meta:
            ==: ItemMeta
            meta-type: BLOCK_STATE
            display-name: Coffre
            internal: $internal
    """.trimIndent()

    @Test
    fun `strips an internal blob that no longer inflates`() {
        val text = wrapped(Base64.getEncoder().encodeToString("not gzip at all".toByteArray()))

        val cleaned = LegacyInternalTag.stripUnreadable(text)

        assertNotNull(cleaned, "an unreadable blob must be reported as stripped")
        assertFalse(cleaned!!.contains("internal"), "the dead key must be gone")
        // Everything else survives — the item still loads with its name.
        assertTrue(cleaned.contains("SHULKER_BOX"))
        assertTrue(cleaned.contains("Coffre"))
        assertTrue(cleaned.contains("BLOCK_STATE"))
    }

    @Test
    fun `leaves a readable internal blob untouched`() {
        val text = wrapped(gzippedBase64("a perfectly valid payload"))

        assertNull(
            LegacyInternalTag.stripUnreadable(text),
            "a blob that still inflates must not be touched",
        )
    }

    @Test
    fun `returns null when there is no internal key at all`() {
        val modern = """
            item:
              ==: org.bukkit.inventory.ItemStack
              DataVersion: 4671
              id: minecraft:diamond_sword
              count: 1
        """.trimIndent()

        assertNull(LegacyInternalTag.stripUnreadable(modern))
    }

    @Test
    fun `detects a blob folded across several lines by the yaml dumper`() {
        // SnakeYAML wraps long plain scalars at ~80 columns; the value must be
        // resolved (folded lines rejoined) before it can be validated.
        val long = Base64.getEncoder().encodeToString(ByteArray(600) { 0x41 })
        // Built line by line: a raw string's trimIndent() would re-indent the
        // injected continuation lines and break the document.
        val text = buildString {
            appendLine("item:")
            appendLine("  ==: org.bukkit.inventory.ItemStack")
            appendLine("  type: SHULKER_BOX")
            appendLine("  meta:")
            appendLine("    ==: ItemMeta")
            appendLine("    internal: " + long.chunked(70).joinToString("\n      "))
        }

        val cleaned = LegacyInternalTag.stripUnreadable(text)

        assertNotNull(cleaned, "a folded unreadable blob must still be detected")
        assertFalse(cleaned!!.contains("internal"))
    }

    @Test
    fun `survives a file that is not yaml at all`() {
        assertNull(LegacyInternalTag.stripUnreadable("]: internal not yaml {{{"))
    }
}
