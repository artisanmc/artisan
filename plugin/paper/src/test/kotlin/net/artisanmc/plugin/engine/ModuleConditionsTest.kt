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
}
