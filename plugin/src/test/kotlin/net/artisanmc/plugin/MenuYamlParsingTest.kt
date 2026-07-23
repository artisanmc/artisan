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
    fun `appearance head field is parsed`() {
        val yaml = """
            schema: menu/v1
            id: heads
            title: []
            size: 9
            layers:
              - id: main
                name: Main
                elements:
                  - id: hd
                    positions: "0"
                    appearances:
                      - material: PLAYER_HEAD
                        head: "hdb:128276"
        """.trimIndent()
        val menu = mapper.readValue<MenuYaml>(yaml)
        assertEquals("hdb:128276", menu.layers[0].elements[0].appearances[0].head)
    }

    @Test
    fun `click handler as bare DSL string parses (canonical collapsed form)`() {
        val menu = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: shop
            size: 9
            layers:
              - id: l
                name: L
                elements:
                  - id: e
                    positions: "0"
                    appearances:
                      - material: STONE
                        click:
                          left: close_menu
                          right:
                            steps: "open_menu other"
            """.trimIndent(),
        )
        val click = menu.layers[0].elements[0].appearances[0].click
        assertEquals("close_menu", click["left"]?.steps)
        assertEquals("open_menu other", click["right"]?.steps)
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

    @Test
    fun `parses inventory_type, defaulting to chest`() {
        val hopper = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: h
            title: []
            inventory_type: hopper
            size: 5
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
        assertEquals("hopper", hopper.inventoryType)

        val chest = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: c
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
        assertEquals("chest", chest.inventoryType)
    }
}
