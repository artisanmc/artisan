package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.ImageButtonLayout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Same cases as imageButtonArea.test.ts (editor) and imageButtons.test.ts
 * (backend): all three must agree on which slots form a button and where its
 * image is drawn.
 */
class ImageButtonLayoutTest {
    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    private fun layout(positions: String, type: String = "chest", size: Int = 27, hidden: Boolean = false): Pair<Int, Int>? {
        val menu = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: m
            size: $size
            inventory_type: $type
            ${if (hidden) "player_inventory: hidden" else ""}
            elements:
              - id: btn
                positions: "$positions"
                image: { asset: a }
            """.trimIndent(),
        )
        val l = ImageButtonLayout.of(menu, menu.allElements.single()) ?: return null
        assertEquals(l.slots.size * 18 * 18, l.width * l.height)
        return l.x to l.y
    }

    @Test fun `a rectangle of the menu grid starts at its type's slot origin`() {
        assertEquals(7 to 17, layout("0,1,9,10"))
        assertEquals(61 to 19, layout("1,2", type = "hopper", size = 5))
        assertEquals(79 to 34, layout("4,7", type = "dropper", size = 9))
    }

    @Test fun `with a hidden bottom, a rectangle may sit in the inventory rows or the hotbar`() {
        assertEquals(25 to 84, layout("28,29,37,38", hidden = true))
        assertEquals(7 to 142, layout("54-56", hidden = true))
        assertEquals(7 to 50, layout("5", type = "hopper", size = 5, hidden = true))
        assertEquals(7 to 141, layout("36", type = "dropper", size = 9, hidden = true))
    }

    @Test fun `the player inventory is refused when the bottom is visible`() {
        assertNull(layout("27"))
    }

    @Test fun `a rectangle never straddles two sections, nor has holes`() {
        assertNull(layout("18,27", hidden = true))
        assertNull(layout("45,54", hidden = true))
        assertNull(layout("0,2"))
        assertNull(layout("63", hidden = true))
    }
}
