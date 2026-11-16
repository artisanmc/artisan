package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.integrations.SoftDepRegistry
import kotlin.test.*

/** `api.getConditions()`: a module's requirements through the engine's evaluator. */
class ModuleConditionsTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val warnings = mutableListOf<String>()
    private var evaluator: ConditionEvaluator? = ConditionEvaluator(SoftDepRegistry.EMPTY, CooldownStore())
    private var owned = true
    private val api = ModuleConditions({ evaluator }, { owned }, { warnings += it })

    private fun player() = MockBukkit.getMock()!!.addPlayer().also { it.level = 12 }

    @Test fun `an empty list holds`() {
        assertTrue(api.test(player(), emptyList<Any>()))
    }

    @Test fun `the list is an AND`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "quests.vip", true)
        assertTrue(api.test(p, listOf(mapOf("has_level" to 10), mapOf("has_permission" to "quests.vip"))))
        assertFalse(api.test(p, listOf(mapOf("has_level" to 10), mapOf("has_permission" to "quests.admin"))))
    }

    @Test fun `args are bound for expression conditions`() {
        val requirement = listOf(mapOf("expression" to "completed >= 3"))
        assertTrue(api.test(player(), requirement, mapOf("completed" to 3)))
        assertFalse(api.test(player(), requirement, mapOf("completed" to 2)))
    }

    @Test fun `a malformed entry fails closed and is warned once`() {
        val p = player()
        val bad = listOf(mapOf("has_level" to 1), mapOf("has_levle" to 1))
        assertFalse(api.test(p, bad))
        assertFalse(api.test(p, bad))
        assertEquals(1, warnings.size)
        assertTrue("#1" in warnings.single())
    }

    @Test fun `validate reports each rejected entry by index`() {
        val problems = api.validate(listOf(mapOf("has_level" to 1), mapOf("nope" to 1), mapOf("world_is" to "")))
        assertEquals(2, problems.size)
        assertTrue(problems[0].startsWith("condition #1"))
        assertTrue(problems[1].startsWith("condition #2"))
        assertEquals(emptyList(), api.validate(listOf(mapOf("has_level" to 1))))
    }

    @Test fun `before the engine starts every non-empty list is false`() {
        evaluator = null
        assertFalse(api.test(player(), listOf(mapOf("has_level" to 1))))
        assertEquals(1, warnings.size)
    }

    @Test fun `off the player's thread it throws`() {
        owned = false
        assertFailsWith<IllegalStateException> { api.test(player(), emptyList<Any>()) }
    }

    // --- without a player (API 1.3.0) ---

    @Test fun `without a player, an expression reads the args`() {
        val rankup = listOf(mapOf("expression" to "guild_level >= 2"))
        assertTrue(api.testWithoutPlayer(rankup, mapOf("guild_level" to 2)))
        assertFalse(api.testWithoutPlayer(rankup, mapOf("guild_level" to 1)))
        assertFalse(api.testWithoutPlayer(rankup, emptyMap<String, Any>()), "a missing arg is null, so false")
        assertTrue(api.testWithoutPlayer(emptyList<Any>(), emptyMap<String, Any>()))
        assertEquals(emptyList(), warnings)
    }

    @Test fun `without a player, not, and, or combine what needs none`() {
        val list = listOf(mapOf("or" to listOf(mapOf("expression" to "a > 1"), mapOf("not" to mapOf("expression" to "b")))))
        assertTrue(api.testWithoutPlayer(list, mapOf("a" to 0, "b" to false)))
        assertFalse(api.testWithoutPlayer(list, mapOf("a" to 0, "b" to true)))
    }

    @Test fun `a player-bound condition fails the whole list, even under not, warned once`() {
        val list = listOf(mapOf("not" to mapOf("has_permission" to "guild.banned")))
        assertFalse(api.testWithoutPlayer(list, emptyMap<String, Any>()), "not: of a refused operand must not turn true")
        assertFalse(api.testWithoutPlayer(list, emptyMap<String, Any>()))
        assertEquals(1, warnings.size)
        assertTrue("needs a player (has_permission)" in warnings.single(), warnings.single())
    }

    @Test fun `validateWithoutPlayer names what needs a player, by index`() {
        val problems = api.validateWithoutPlayer(listOf(
            mapOf("expression" to "level >= 2"),
            mapOf("has_permission" to "x"),
            mapOf("nope" to 1),
            mapOf("expression" to "%vault_eco_balance% > 3"),
        ))
        assertEquals(3, problems.size)
        assertTrue(problems[0].startsWith("condition #1 needs a player (has_permission)"), problems[0])
        assertTrue(problems[1].startsWith("condition #2 is unknown"), problems[1])
        assertTrue(problems[2].startsWith("condition #3 needs a player (expression placeholder %vault_eco_balance%)"), problems[2])
        assertEquals(emptyList(), api.validate(listOf(mapOf("has_permission" to "x"))), "validate itself is unchanged")
    }

    @Test fun `without a player, the thread is not checked and the engine must have started`() {
        owned = false
        assertTrue(api.testWithoutPlayer(listOf(mapOf("expression" to "true")), emptyMap<String, Any>()))
        evaluator = null
        assertFalse(api.testWithoutPlayer(listOf(mapOf("expression" to "true")), emptyMap<String, Any>()))
    }
}
