package net.artisanmc.modules.triggers

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TriggerTest {
    @Test
    fun `reads a trigger v1 document`() {
        val t = Trigger.parse("demo", mapOf(
            "id" to "death_coords", "schema" to "trigger/v1", "on" to "player_death",
            "if" to listOf(mapOf("world_is" to "arena")), "cooldown_seconds" to 30,
            "do" to listOf(mapOf("send_message" to "x")),
        )).getOrThrow()
        assertEquals("demo/death_coords", t.ref)
        assertEquals("player_death", t.on)
        assertEquals(1, t.conditions.size)
        assertEquals(30, t.cooldownSeconds)
        assertTrue(t.enabled)
    }

    @Test
    fun `defaults and tolerant spellings`() {
        val t = Trigger.parse("demo", mapOf("id" to "a", "on" to " player_join ", "if" to mapOf("has_permission" to "x"), "cooldown_seconds" to "5", "enabled" to false)).getOrThrow()
        assertEquals("player_join", t.on)
        assertEquals(1, t.conditions.size, "a single condition is a list of one")
        assertEquals(5, t.cooldownSeconds)
        assertFalse(t.enabled)
        assertEquals(0, Trigger.parse("demo", mapOf("id" to "b", "on" to "x")).getOrThrow().cooldownSeconds)
    }

    @Test
    fun `a trigger without an event or with a bad cooldown does not run`() {
        assertTrue(Trigger.parse("demo", mapOf("id" to "a")).isFailure)
        assertTrue(Trigger.parse("demo", mapOf("id" to "a", "on" to "x", "cooldown_seconds" to "soon")).isFailure)
    }
}
