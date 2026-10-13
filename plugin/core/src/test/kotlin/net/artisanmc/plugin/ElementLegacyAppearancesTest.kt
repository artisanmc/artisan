package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Menus written BEFORE the flat display carry `appearances:`, a list whose first
 * entry acts as the display.
 *
 * If the reader ignored them, the menu would open without its items, in game and in
 * the editor, with no error and no log. An Add-on whose bootstrap never touches an
 * existing project leaves these files in place indefinitely.
 *
 * So they are still read. The editor rewrites the current format on the first save:
 * the tolerance is a bridge, not a second form.
 */
class ElementLegacyAppearancesTest {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    private fun parse(yaml: String): MenuYaml = mapper.readValue(yaml.trimIndent(), MenuYaml::class.java)

    @Test
    fun `la premiere appearance devient le display, les suivantes des states`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: acheter
                positions: 11
                appearances:
                  - material: DIAMOND
                    title: "Acheter"
                  - material: BARRIER
                    if:
                      - type: has_permission
                        perm: vip
            """,
        )
        val el = menu.allElements.single()
        assertEquals("DIAMOND", el.display.material)
        assertEquals(1, el.states.size)
        assertEquals("BARRIER", el.states.single().material)
    }

    @Test
    fun `le format courant l'emporte sur une liste residuelle`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: acheter
                positions: 11
                material: ARROW
                appearances:
                  - material: DIAMOND
            """,
        )
        assertEquals("ARROW", menu.allElements.single().display.material)
    }
}
