package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.MenuCompiler
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * ADR `element-display-and-states` — the display is written flat on the element,
 * the guarded states under `states:`. A state is a whole appearance, never a
 * patch, and states resolve BEFORE the display (which is the fallback).
 */
class ElementDisplayStatesTest {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    private fun parse(yaml: String): MenuYaml = mapper.readValue(yaml.trimIndent(), MenuYaml::class.java)

    @Test
    fun `element's own fields are its display`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: back
                positions: 49
                material: ARROW
                title: "§7Retour"
                click:
                  left: open_menu shop_main
            """,
        )
        val el = menu.allElements.single()
        assertEquals("ARROW", el.display.material)
        assertEquals("§7Retour", el.display.title?.forLang("en", "en"))
        assertTrue(el.display.click.containsKey("left"))
        assertTrue(el.states.isEmpty())
    }

    @Test
    fun `states are read in order and inherit nothing`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: buy
                positions: 22
                material: DIAMOND
                title: "§aAcheter"
                states:
                  - if: [{ type: has_permission, perm: vip }]
                    material: EMERALD
                  - if: [{ type: has_money, amount: 100 }]
                    material: BARRIER
            """,
        )
        val el = menu.allElements.single()
        assertEquals("DIAMOND", el.display.material)
        assertEquals(listOf("EMERALD", "BARRIER"), el.states.map { it.material })
        // A state omitting `title` has none — it does not inherit the display's.
        assertNull(el.states[0].title)
    }

    @Test
    /**
     * Old files do survive in production, and a menu without its items looks like a
     * misconfiguration rather than a failure. See `ElementLegacyAppearancesTest`.
     */
    fun `the legacy appearances list is still read`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: old
                positions: 0
                appearances:
                  - material: GOLD_INGOT
            """,
        )
        assertEquals("GOLD_INGOT", menu.allElements.single().display.material)
    }

    @Test
    fun `compiled order is states first, display last`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: buy
                positions: 22
                material: DIAMOND
                states:
                  - if: [{ type: has_permission, perm: vip }]
                    material: EMERALD
            """,
        )
        val compiled = MenuCompiler.compile(menu, emptyMap()).compiledAppearances["buy"]!!
        assertEquals(listOf("EMERALD", "DIAMOND"), compiled.map { it.yaml.material })
        // The display is the one that always applies — it carries no condition.
        assertTrue(compiled.last().conditions.isEmpty())
        assertTrue(compiled.first().conditions.isNotEmpty())
    }

    @Test
    fun `i18n addressing stays display-first`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: buy
                positions: 22
                material: DIAMOND
                states:
                  - if: [{ type: has_permission, perm: vip }]
                    material: EMERALD
            """,
        )
        val compiled = MenuCompiler.compile(menu, emptyMap()).compiledAppearances["buy"]!!
        // states[0] is addressed `state1`; the display keeps `default`.
        assertEquals("menus.shop.elements.buy.state1", compiled.first().i18nBase)
        assertEquals("menus.shop.elements.buy.default", compiled.last().i18nBase)
    }
}
