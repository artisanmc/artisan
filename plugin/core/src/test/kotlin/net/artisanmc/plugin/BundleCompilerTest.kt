package net.artisanmc.plugin

import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.*
import kotlin.test.*

class BundleCompilerTest {

    private fun menu(vararg elements: ElementYaml) = MenuYaml(
        id = "test_menu", title = "Test", size = 27,
        layers = listOf(LayerYaml(id = "base", elements = elements.toList())),
    )

    /** First appearance = the display, the rest = its guarded states. */
    private fun element(id: String, positions: String, vararg appearances: AppearanceYaml) =
        ElementYaml(
            id = id,
            positions = positions,
            display = appearances.firstOrNull() ?: AppearanceYaml(),
            states = appearances.drop(1),
        )

    private fun appearance(material: String = "STONE", click: Map<String, ClickHandlerYaml> = emptyMap()) =
        AppearanceYaml(material = material, click = click)

    private fun handler(vararg actions: Map<String, Any>) =
        ClickHandlerYaml(actions = actions.toList())

    @Test fun `compile empty menu has empty compiledAppearances and slotToElement`() {
        val result = BundleCompiler.compile(MenuYaml(id = "m", size = 27), emptyMap())
        assertTrue(result.compiledAppearances.isEmpty())
        assertTrue(result.slotToElement.isEmpty())
    }

    @Test fun `compile accepts flat elements — later element wins the slot`() {
        val m = MenuYaml(
            id = "flat", size = 27,
            elements = listOf(
                element("under", "13", appearance("STONE")),
                element("over", "13", appearance("DIRT")),
            ),
        )
        val result = BundleCompiler.compile(m, emptyMap())
        assertEquals("over", result.slotToElement[13])
        assertTrue("under" in result.compiledAppearances)
    }

    @Test fun `compile populates slotToElement for single slot`() {
        val m = menu(element("btn", "13", appearance()))
        val result = BundleCompiler.compile(m, emptyMap())
        assertEquals("btn", result.slotToElement[13])
    }

    @Test fun `compile populates slotToElement for range`() {
        val m = menu(element("row", "0-8", appearance()))
        val result = BundleCompiler.compile(m, emptyMap())
        (0..8).forEach { assertEquals("row", result.slotToElement[it]) }
    }

    @Test fun `compile populates slotToElement for comma list`() {
        val m = menu(element("corners", "0,8,18,26", appearance()))
        val result = BundleCompiler.compile(m, emptyMap())
        listOf(0, 8, 18, 26).forEach { assertEquals("corners", result.slotToElement[it]) }
    }

    @Test fun `compile stores CompiledAppearance per element`() {
        val app = appearance("DIAMOND", mapOf(
            "left" to handler(mapOf("type" to "close_menu")),
        ))
        val m = menu(element("btn", "13", app))
        val result = BundleCompiler.compile(m, emptyMap())
        val compiled = result.compiledAppearances["btn"]
        assertNotNull(compiled)
        assertEquals(1, compiled.size)
        val ca = compiled[0]
        assertTrue(ca.conditions.isEmpty())
        assertEquals(1, ca.clicks.size)
        assertIs<Action.CloseMenu>(ca.clicks[ClickType.LEFT]?.actions?.firstOrNull())
    }

    @Test fun `compile skips unknown click type`() {
        val app = appearance("STONE", mapOf(
            "hover" to handler(mapOf("type" to "close_menu")),
        ))
        val m = menu(element("btn", "0", app))
        val result = BundleCompiler.compile(m, emptyMap())
        val compiled = result.compiledAppearances["btn"]?.firstOrNull()
        assertNotNull(compiled)
        assertTrue(compiled.clicks.isEmpty())
    }

    @Test fun `compile handles appearance with conditions`() {
        val condMap = mapOf("type" to "has_permission", "perm" to "vip")
        val app = AppearanceYaml(material = "GOLD_BLOCK", conditions = condMap)
        val m = menu(element("el", "0", app))
        val result = BundleCompiler.compile(m, emptyMap())
        val ca = result.compiledAppearances["el"]?.firstOrNull()
        assertNotNull(ca)
        assertEquals(listOf(Condition.HasPermission("vip")), ca.conditions)
    }

    @Test fun `compile parses canonical click steps into a step tree`() {
        // steps is an Action DSL string (ADR action-dsl).
        val clickYaml = ClickHandlerYaml(
            steps = "if has_money(100):\n  take_money 100\nelse:\n  send_message \"no\"\nclose_menu",
        )
        val m = menu(element("btn", "13", appearance("STONE", mapOf("left" to clickYaml))))
        val result = BundleCompiler.compile(m, emptyMap())
        val clickHandler = result.compiledAppearances["btn"]!!.first().clicks[ClickType.LEFT]
        assertNotNull(clickHandler)
        assertEquals(2, clickHandler.steps.size)
        val ifs = assertIs<Step.IfStep>(clickHandler.steps[0])
        assertEquals(1, ifs.cases.size)
        assertIs<Step.ActionStep>(ifs.cases[0].steps.single())
        assertIs<Step.ActionStep>(ifs.elseSteps.single())
        assertIs<Step.ActionStep>(clickHandler.steps[1])
    }

    @Test fun `compile drops the appearance when a step contains an unknown action`() {
        // An unknown verb makes the DSL parse throw → the appearance is dropped.
        val clickYaml = ClickHandlerYaml(steps = "does_not_exist")
        val m = menu(element("btn", "0", appearance("STONE", mapOf("left" to clickYaml)), appearance("DIRT")))
        val result = BundleCompiler.compile(m, emptyMap())
        assertEquals(1, result.compiledAppearances["btn"]?.size)
    }

    @Test fun `compile skips appearance with invalid action but keeps others`() {
        val goodApp = appearance("STONE", mapOf("left" to handler(mapOf("type" to "close_menu"))))
        val badApp  = appearance("DIAMOND", mapOf("left" to handler(mapOf("type" to "nonexistent_action"))))
        val m = menu(element("el", "0", goodApp, badApp))
        val result = BundleCompiler.compile(m, emptyMap())
        val compiled = result.compiledAppearances["el"]
        assertNotNull(compiled)
        assertEquals(1, compiled.size)
    }
}
