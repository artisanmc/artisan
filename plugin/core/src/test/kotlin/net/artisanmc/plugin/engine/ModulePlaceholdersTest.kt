package net.artisanmc.plugin.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ModulePlaceholdersTest {
    private val homes = mapOf("count" to "3", "max_free" to "5")
    private fun lookup(ns: String, key: String) = if (ns == "homes") homes[key] else null

    @Test
    fun `known tokens are replaced, the others left for PlaceholderAPI`() {
        assertEquals(
            "3/5 homes, %vault_eco_balance%, %homes_unknown%",
            expandPlaceholders("%homes_count%/%homes_max_free% homes, %vault_eco_balance%, %homes_unknown%", ::lookup),
        )
    }

    @Test
    fun `text without tokens is returned as is`() {
        assertEquals("100% sure", expandPlaceholders("100% sure", ::lookup))
    }

    @Test
    fun `namespaces are lowercase identifiers`() {
        assertTrue(isPlaceholderNamespace("homes"))
        assertTrue(isPlaceholderNamespace("shop2"))
        assertFalse(isPlaceholderNamespace("my_shop"))
        assertFalse(isPlaceholderNamespace("Homes"))
        assertFalse(isPlaceholderNamespace("2shop"))
        assertFalse(isPlaceholderNamespace(""))
    }
}
