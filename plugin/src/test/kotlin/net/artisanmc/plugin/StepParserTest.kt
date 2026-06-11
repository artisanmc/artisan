package net.artisanmc.plugin

import net.artisanmc.plugin.engine.*
import kotlin.test.*

class StepParserTest {

    private fun action(vararg pairs: Pair<String, Any>): Map<String, Any> =
        mapOf("kind" to "action", "action" to mapOf(*pairs))

    @Test fun `parses a flat action step`() {
        val steps = StepParser.parseAll(listOf(action("type" to "run_command", "command" to "spawn")))
        assertEquals(1, steps.size)
        val s = assertIs<Step.ActionStep>(steps[0])
        assertEquals(Action.RunCommand("spawn"), s.action)
    }

    @Test fun `parses an if step with cases joins and else`() {
        val raw = mapOf(
            "kind" to "if",
            "cases" to listOf(
                mapOf(
                    "conditions" to listOf(
                        mapOf("type" to "has_permission", "perm" to "a"),
                        mapOf("type" to "has_permission", "perm" to "b"),
                    ),
                    "joins" to listOf("or"),
                    "steps" to listOf(action("type" to "close_menu")),
                ),
            ),
            "else" to listOf(action("type" to "send_message", "text" to "no")),
        )
        val s = assertIs<Step.IfStep>(StepParser.parse(raw))
        assertEquals(1, s.cases.size)
        val case = s.cases[0]
        assertEquals(
            listOf<Condition>(Condition.HasPermission("a"), Condition.HasPermission("b")),
            case.conditions,
        )
        assertEquals(listOf("or"), case.joins)
        assertIs<Step.ActionStep>(case.steps.single())
        val elseStep = assertIs<Step.ActionStep>(s.elseSteps.single())
        assertEquals(Action.SendMessage("no"), elseStep.action)
    }

    @Test fun `if step without else or joins has empty defaults`() {
        val raw = mapOf(
            "kind" to "if",
            "cases" to listOf(
                mapOf(
                    "conditions" to listOf(mapOf("type" to "has_permission", "perm" to "x")),
                    "steps" to listOf(action("type" to "close_menu")),
                ),
            ),
        )
        val s = assertIs<Step.IfStep>(StepParser.parse(raw))
        assertTrue(s.elseSteps.isEmpty())
        assertTrue(s.cases[0].joins.isEmpty())
    }

    @Test fun `parses nested if steps`() {
        val inner = mapOf(
            "kind" to "if",
            "cases" to listOf(
                mapOf(
                    "conditions" to listOf(mapOf("type" to "has_money", "amount" to 100)),
                    "steps" to listOf(action("type" to "take_money", "amount" to 100.0)),
                ),
            ),
        )
        val outer = mapOf(
            "kind" to "if",
            "cases" to listOf(
                mapOf(
                    "conditions" to emptyList<Map<String, Any>>(),
                    "steps" to listOf(inner),
                ),
            ),
        )
        val s = assertIs<Step.IfStep>(StepParser.parse(outer))
        assertIs<Step.IfStep>(s.cases[0].steps.single())
    }

    @Test fun `throws on unknown step kind`() {
        assertFailsWith<IllegalArgumentException> { StepParser.parse(mapOf("kind" to "loop")) }
    }

    @Test fun `throws on unknown action type inside a step`() {
        assertFailsWith<IllegalArgumentException> { StepParser.parse(action("type" to "does_not_exist")) }
    }
}
