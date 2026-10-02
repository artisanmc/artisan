package net.artisanmc.plugin

import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.*
import kotlin.test.*

/**
 * ADR `structured-action-wire` — wire d'action keyed par nom, côté plugin.
 */
class KeyedStepParserTest {

    private fun menu(vararg elements: ElementYaml) = MenuYaml(
        id = "test_menu", title = "Test", size = 27,
        layers = listOf(LayerYaml(id = "base", elements = elements.toList())),
    )

    @Test fun `parses scalar, bare string and null keyed actions`() {
        val steps = KeyedStepParser.parseKeyed(
            listOf(
                mapOf("send_message" to "Hi"),
                "close_menu",
                mapOf("close_dialog" to null),
                mapOf("give_money" to 100),
                mapOf("run_command" to mapOf("command" to "op", "as" to "console")),
            ),
        )
        assertEquals(5, steps.size)
        assertEquals(LocalizedText.of("Hi"), (steps[0] as Step.ActionStep).action.let { (it as Action.SendMessage).text })
        assertEquals(Action.CloseMenu, (steps[1] as Step.ActionStep).action)
        assertEquals(Action.CloseDialog, (steps[2] as Step.ActionStep).action)
        assertEquals(Action.GiveMoney(100.0), (steps[3] as Step.ActionStep).action)
        assertEquals(Action.RunCommand("op", asConsole = true), (steps[4] as Step.ActionStep).action)
    }

    @Test fun `action text accepts a field-local lang map`() {
        val steps = KeyedStepParser.parseKeyed(
            mapOf("send_message" to mapOf("en" to "Hi", "fr" to "Salut")),
        )
        val msg = (steps.single() as Step.ActionStep).action as Action.SendMessage
        assertEquals("Salut", msg.text.forLang("fr", "en"))
        assertEquals("Hi", msg.text.forLang("en", "fr"))
        assertEquals("Hi", msg.text.forLang("de", "en"))
    }

    @Test fun `parses if with or`() {
        val raw = listOf(
            mapOf(
                "if" to listOf(
                    mapOf("has_permission" to "shop.vip"),
                    mapOf("or" to listOf(mapOf("world_is" to "world_nether"), mapOf("time_is" to "night"))),
                ),
                "do" to listOf(mapOf("send_message" to "ok")),
                "else" to listOf(mapOf("send_message" to "no")),
            ),
        )
        val ifStep = KeyedStepParser.parseKeyed(raw).single() as Step.IfStep
        assertEquals(1, ifStep.cases.size)
        val conds = ifStep.cases[0].conditions
        assertEquals(2, conds.size)
        assertEquals(Condition.HasPermission("shop.vip"), conds[0])
        assertEquals(
            Condition.Or(listOf(Condition.WorldIs("world_nether"), Condition.TimeIs("night"))),
            conds[1],
        )
        assertEquals(1, ifStep.elseSteps.size)
    }

    @Test fun `folds a recursive else-if back into cases`() {
        val raw = listOf(
            mapOf(
                "if" to listOf(mapOf("has_permission" to "a")),
                "do" to listOf("close_menu"),
                "else" to listOf(
                    mapOf(
                        "if" to listOf(mapOf("random_chance" to 0.1)),
                        "do" to listOf("close_dialog"),
                    ),
                ),
            ),
        )
        val ifStep = KeyedStepParser.parseKeyed(raw).single() as Step.IfStep
        assertEquals(2, ifStep.cases.size)
        assertEquals(Condition.RandomChance(0.1), ifStep.cases[1].conditions.single())
    }

    @Test fun `BundleCompiler compiles a keyed click into a step tree`() {
        val app = AppearanceYaml(
            material = "STONE",
            click = mapOf("left" to listOf(mapOf("send_message" to mapOf("en" to "Hi", "fr" to "Salut")))),
        )
        val m = menu(ElementYaml(id = "e", positions = "0", display = app))
        val ca = BundleCompiler.compile(m, emptyMap()).compiledAppearances["e"]!!.first()
        val step = ca.clicks[ClickType.LEFT]!!.steps.single() as Step.ActionStep
        val msg = step.action as Action.SendMessage
        assertEquals("Salut", msg.text.forLang("fr", "en"))
    }

    @Test fun `legacy DSL string still compiles`() {
        val app = AppearanceYaml(material = "STONE", click = mapOf("left" to "close_menu"))
        val m = menu(ElementYaml(id = "e", positions = "0", display = app))
        val ca = BundleCompiler.compile(m, emptyMap()).compiledAppearances["e"]!!.first()
        val step = ca.clicks[ClickType.LEFT]!!.steps.single() as Step.ActionStep
        assertEquals(Action.CloseMenu, step.action)
    }
}
