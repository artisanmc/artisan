package net.artisanmc.plugin

import net.artisanmc.plugin.engine.PapiPlaceholderCatalog
import net.artisanmc.plugin.engine.PapiExpansion
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PapiPlaceholderCatalogTest {
    @Test fun `only reports placeholders explicitly declared by registered expansions`() {
        val catalog = PapiPlaceholderCatalog.collect(listOf(
            PapiExpansion("player") { listOf("%player_name%", "player_health", "%player_name%") },
            PapiExpansion("vault") { emptyList() },
        ))
        assertEquals(listOf("%player_health%", "%player_name%"), catalog.placeholders.map { it.placeholder })
        assertTrue(catalog.placeholders.all { it.expansion == "player" })
        assertFalse(catalog.truncated)
    }

    @Test fun `a broken expansion cannot hide healthy expansions or inject invalid suggestions`() {
        val catalog = PapiPlaceholderCatalog.collect(listOf(
            PapiExpansion("broken") { error("Broken expansion") },
            PapiExpansion("player") { listOf("%player_name%", "%rel_player_friend%", "", "%wrong_name%", "%player_bad value%", "%player_<name>%") },
        ))
        assertEquals(listOf("%player_<name>%", "%player_name%", "%rel_player_friend%"), catalog.placeholders.map { it.placeholder })
    }

    @Test fun `bounds the catalog before sending it to the editor`() {
        val catalog = PapiPlaceholderCatalog.collect(listOf(
            PapiExpansion("test") { (1..3_000).map { "%test_$it%" } },
        ))
        assertTrue(catalog.truncated)
        assertEquals(2_000, catalog.placeholders.size)
    }
}
