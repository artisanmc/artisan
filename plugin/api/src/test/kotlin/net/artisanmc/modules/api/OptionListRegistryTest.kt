package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import net.artisanmc.modules.api.options.OptionEntry
import net.artisanmc.modules.api.options.OptionListRegistry

class OptionListRegistryTest {

    @Test
    fun `reports each list by id, its options in the declared order, read at each report`() {
        val reg = OptionListRegistry()
        val actors = mutableListOf(OptionEntry("player"), OptionEntry("global"))
        reg.bindOwner("msquests")
        reg.declare("quests:actor_types") { actors.toList() }
        reg.bindOwner(null)
        reg.declare("boutique:currencies") { listOf(OptionEntry("coins", mapOf("fr" to "Pièces", "en" to "Coins"))) }

        assertEquals(
            listOf(
                mapOf("id" to "boutique:currencies", "options" to listOf(mapOf("value" to "coins", "labels" to mapOf("en" to "Coins", "fr" to "Pièces")))),
                mapOf("id" to "quests:actor_types", "options" to listOf(mapOf("value" to "player"), mapOf("value" to "global")), "module_id" to "msquests"),
            ),
            reg.toWire(),
        )

        actors += OptionEntry("guild")
        @Suppress("UNCHECKED_CAST")
        val options = reg.toWire().last()["options"] as List<Map<String, Any>>
        assertEquals(listOf("player", "global", "guild"), options.map { it["value"] })
    }

    @Test
    fun `an id is namespaced and declared once`() {
        val reg = OptionListRegistry()
        assertFailsWith<IllegalArgumentException> { reg.declare("actor_types") { emptyList() } }
        assertFailsWith<IllegalArgumentException> { reg.declare("Quests:Actors") { emptyList() } }
        reg.declare("quests:actor_types") { emptyList() }
        assertFailsWith<IllegalArgumentException> { reg.declare("quests:actor_types") { emptyList() } }
        assertTrue(reg.has("quests:actor_types"))
        assertTrue(reg.undeclare("quests:actor_types"))
        assertFalse(reg.has("quests:actor_types"))
    }

    @Test
    fun `a supplier that throws reports an empty list, logged`() {
        val reg = OptionListRegistry()
        val warnings = mutableListOf<String>()
        reg.bindWarnings { warnings += it }
        reg.declare("quests:actor_types") { error("registry closed") }
        assertEquals(listOf(mapOf("id" to "quests:actor_types", "options" to emptyList<Any>())), reg.toWire())
        assertEquals(1, warnings.size)
    }

    @Test
    fun `a change is signalled, and a module's lists leave with it`() {
        val reg = OptionListRegistry()
        var signalled = 0
        reg.bindChanges { signalled++ }
        reg.bindOwner("msquests")
        reg.declare("quests:actor_types") { emptyList() }
        reg.changed()
        assertEquals(1, signalled)
        reg.unregisterOwnedBy("msquests")
        assertFalse(reg.has("quests:actor_types"))
    }

    @Test
    fun `an option needs a value`() {
        assertFailsWith<IllegalArgumentException> { OptionEntry(" ") }
    }
}
