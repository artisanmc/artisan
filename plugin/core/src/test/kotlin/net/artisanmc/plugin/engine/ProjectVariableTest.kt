package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.variable.VariableScope
import net.artisanmc.modules.api.variable.VariableType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProjectVariableTest {
    @Test fun `a variable file reads its scope, type, default and lifetime`() {
        val v = ProjectVariable.parse("rpg", mapOf("id" to "coins", "scope" to "server", "type" to "number", "default" to 10, "expires_seconds" to 600)).getOrThrow()
        assertEquals(ProjectVariable("rpg", "coins", VariableScope.SERVER, VariableType.NUMBER, 10.0, 600), v)
        assertEquals("rpg/coins", v.ref)
        val d = ProjectVariable.parse("rpg", mapOf("id" to "last_death", "type" to "location")).getOrThrow()
        assertEquals(VariableScope.PLAYER, d.scope, "player by default")
        assertEquals(0L, d.expiresSeconds)
    }

    @Test fun `a variable that cannot be used says why`() {
        assertTrue(ProjectVariable.parse("rpg", mapOf("id" to "x")).exceptionOrNull()!!.message!!.contains("type"))
        assertTrue(ProjectVariable.parse("rpg", mapOf("id" to "x", "type" to "date")).isFailure)
        assertTrue(ProjectVariable.parse("rpg", mapOf("id" to "x", "type" to "number", "scope" to "guild")).isFailure)
        assertTrue(ProjectVariable.parse("rpg", mapOf("id" to "x", "type" to "number", "default" to "lots")).isFailure)
    }

    @Test fun `values are typed, never converted across types, and stored as JSON`() {
        assertEquals(3.0, ProjectVariable.typed(VariableType.NUMBER, "3"))
        assertNull(ProjectVariable.typed(VariableType.NUMBER, "three"))
        assertEquals(false, ProjectVariable.typed(VariableType.BOOLEAN, "false"))
        assertNull(ProjectVariable.typed(VariableType.BOOLEAN, "no"))
        assertNull(ProjectVariable.typed(VariableType.STRING, mapOf("a" to 1)))
        val place = LocationValue("world", 1.0, 2.0, 3.0)
        val json = ProjectVariable.encode(place)
        assertEquals(place, ProjectVariable.decode(VariableType.LOCATION, json))
        assertNull(ProjectVariable.decode(VariableType.NUMBER, json), "the type changed: read as absent")
        assertEquals("a \"quoted\" text", ProjectVariable.decode(VariableType.STRING, ProjectVariable.encode("a \"quoted\" text")))
    }
}
