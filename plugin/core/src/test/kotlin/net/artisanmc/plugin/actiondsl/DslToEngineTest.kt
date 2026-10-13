package net.artisanmc.plugin.actiondsl

import net.artisanmc.plugin.engine.Action
import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.IfCase
import net.artisanmc.plugin.engine.Step
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Unit-tests the DSL AST → engine model mapper (ADR action-dsl). */
class DslToEngineTest {

    private fun map(dsl: String): List<Step> = dslToEngineSteps(parseActionDsl(dsl))

    @Test fun `set string literals decode quotes and escapes before template resolution`() {
        assertEquals(
            listOf(Step.ActionStep(Action.SetArg("label", "Say \"hello\" to {player.name}"))),
            map("""set label = "Say \"hello\" to {player.name}""""),
        )
        assertEquals(
            listOf(Step.ActionStep(Action.SetArg("label", ""))),
            map("set label = \"\""),
        )
        assertEquals(
            listOf(Step.ActionStep(Action.SetArg("label", "tools"))),
            map("set label = tools"),
        )
    }

    @Test fun `flat actions map field-by-field with numeric narrowing`() {
        val steps = map(
            """
            send_message "hello {name}"
            give_item DIAMOND 3
            take_money 12.5
            give_xp 10
            play_sound PLING vol=1 pitch=1.2
            """.trimIndent(),
        )
        assertEquals(
            listOf(
                Step.ActionStep(Action.SendMessage("hello {name}")),
                Step.ActionStep(Action.GiveItem("DIAMOND", 3)),
                Step.ActionStep(Action.TakeMoney(12.5)),
                Step.ActionStep(Action.GiveXp(10)),
                Step.ActionStep(Action.PlaySound("PLING", 1f, 1.2f)),
            ),
            steps,
        )
    }

    @Test fun `i18n ref becomes an {i18n} template, literal stays raw`() {
        assertEquals(
            listOf(Step.ActionStep(Action.Broadcast("{i18n:welcome.msg}"))),
            map("broadcast @welcome.msg"),
        )
        assertEquals(
            listOf(Step.ActionStep(Action.SendMessage("plain {price}"))),
            map("send_message \"plain {price}\""),
        )
    }

    @Test fun `if with joins maps conditions, joins and branches`() {
        val steps = map(
            """
            if has_permission(vip) and has_money(100):
              give_money 50
            else:
              broadcast @poor
            """.trimIndent(),
        )
        assertEquals(
            listOf(
                Step.IfStep(
                    cases = listOf(
                        IfCase(
                            conditions = listOf(
                                Condition.HasPermission("vip"),
                                Condition.HasMoney(100.0),
                            ),
                            joins = listOf("and"),
                            steps = listOf(Step.ActionStep(Action.GiveMoney(50.0))),
                        ),
                    ),
                    elseSteps = listOf(Step.ActionStep(Action.Broadcast("{i18n:poor}"))),
                ),
            ),
            steps,
        )
    }

    @Test fun `time_is named and tick ranges map to the engine String form`() {
        // Named window, via the parser.
        assertEquals(
            Condition.TimeIs("night"),
            (map("if time_is(night):\n  give_level 1")[0] as Step.IfStep).cases[0].conditions[0],
        )
        // Tick range mapped directly from the AST (from-to → "from-to").
        val ast = listOf(
            DslStep.IfStep(
                cases = listOf(
                    DslIfCase(
                        conditions = listOf(DslCondition.TimeIs(TimeRange.Ticks(1000, 5000))),
                        joins = null,
                        steps = listOf(DslStep.ActionStep(DslAction.GiveLevel(1.0))),
                    ),
                ),
                elseSteps = null,
            ),
        )
        assertEquals(
            Condition.TimeIs("1000-5000"),
            (dslToEngineSteps(ast)[0] as Step.IfStep).cases[0].conditions[0],
        )
    }

    @Test fun `a free comparison falls back to Condition Expression`() {
        // Leaf eval deferred (ADR §6) — the comparison round-trips as an opaque expr.
        val expr = map("if balance >= 100:\n  give_level 1")
        val cond = (expr[0] as Step.IfStep).cases[0].conditions[0]
        assertTrue(cond is Condition.Expression, "expected Expression, got $cond")
    }

    @Test fun `run_actions verb maps to the RunActions engine action`() {
        assertEquals(
            listOf(Step.ActionStep(Action.RunActions("item.on_buy"))),
            map("run_actions item.on_buy"),
        )
    }
}
