package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.*

class MenuYamlParsingTest {
    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Test
    fun `parses context_inputs and iterates from canonical menu yaml`() {
        val yaml = """
            schema: menu/v1
            id: shop
            title: []
            size: 27
            context_inputs:
              - name: category
                type: string
                default: all
              - name: shops
                type: list
                source:
                  ref: "chestshop:items"
            layers:
              - id: main
                name: Main
                elements:
                  - id: grid
                    positions: "10-16"
                    iterates: { source: shops, alias: shop }
                    appearances:
                      - material: "{shop.material}"
        """.trimIndent()
        val menu = mapper.readValue<MenuYaml>(yaml)
        assertEquals(2, menu.contextInputs.size)
        assertEquals("category", menu.contextInputs[0].name)
        assertEquals("all", menu.contextInputs[0].default)
        assertEquals("chestshop:items", menu.contextInputs[1].source["ref"])
        val el = menu.layers[0].elements[0]
        assertEquals("shops", el.iterates?.source)
        assertEquals("shop", el.iterates?.alias)
    }

    @Test
    fun `menus without these fields still parse (back-compat)`() {
        val menu = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: simple
            size: 9
            layers:
              - id: l
                name: L
                elements:
                  - id: e
                    positions: "0"
                    appearances:
                      - material: STONE
            """.trimIndent(),
        )
        assertTrue(menu.contextInputs.isEmpty())
        assertNull(menu.layers[0].elements[0].iterates)
    }
}
