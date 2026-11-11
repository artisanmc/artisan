package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.gameevent.GameEventRegistry
import org.bukkit.event.Cancellable
import org.bukkit.event.Event
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The admission rules of the core catalog (ADR `triggers-and-variables` §2): this test is what
 * decides whether an event may enter it.
 */
class CoreGameEventsTest {
    private val catalog = CoreGameEvents.ALL

    @Test
    fun `names are unique and register in one registry`() {
        val names = catalog.map { it.declaration.name }
        assertEquals(names.size, names.toSet().size)
        val reg = GameEventRegistry()
        catalog.forEach { reg.register(it.declaration) }
        assertEquals(names.sorted(), reg.declarations().map { it.name })
    }

    @Test
    fun `rule 1 - no asynchronous event`() {
        // Bukkit's asynchronous events say so in their name (AsyncPlayerChatEvent,
        // AsyncPlayerPreLoginEvent, Paper's AsyncChatEvent); the chat is out of v1 (Q5).
        for (entry in catalog) {
            var c: Class<*>? = entry.type
            while (c != null && c != Event::class.java) {
                assertFalse(c.simpleName.startsWith("Async"), "${entry.declaration.name}: ${c.name} is asynchronous")
                c = c.superclass
            }
        }
    }

    @Test
    fun `rule 3 and 4 - a declared frequency and typed, named fields`() {
        for (entry in catalog) {
            val d = entry.declaration
            assertTrue(d.frequency != null, d.name)
            (d.context + d.effects).forEach { assertTrue(it.name.matches(Regex("^[a-z][a-z0-9_]*$")), "${d.name}.${it.name}") }
        }
    }

    @Test
    fun `cancellable is declared only where Bukkit can cancel`() {
        for (entry in catalog) {
            if (entry.declaration.isCancellable) {
                assertTrue(Cancellable::class.java.isAssignableFrom(entry.type), "${entry.declaration.name} declares cancellable on ${entry.type.simpleName}")
            }
        }
    }

    @Test
    fun `the events Artisan fires itself register beside the catalog, under their own domain`() {
        val reg = GameEventRegistry()
        catalog.forEach { reg.register(it.declaration) }
        CoreGameEvents.FIRED_BY_ARTISAN.forEach(reg::register)
        assertEquals(listOf("variables"), CoreGameEvents.FIRED_BY_ARTISAN.map { it.group }.distinct())
        assertTrue(reg.has("variable_changed"))
    }

    @Test
    fun `the domains the editor groups by`() {
        assertEquals(
            setOf("connection", "life", "world", "blocks", "items", "combat", "progression", "commands"),
            catalog.map { it.declaration.group }.toSet(),
        )
    }
}
