package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.MenuCompiler
import net.artisanmc.plugin.model.LabelYaml
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.ImageButtonLayout
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.artisanmc.plugin.resourcepack.AssetEntry
import org.bukkit.Material
import kotlin.test.*

class MenuRendererLabelTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun menu(yaml: String) = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>(yaml.trimIndent())

    @Test fun `a label is centred in its element's slot rectangle`() {
        val layout = ImageButtonLayout(listOf(7, 8), x = 133, y = 17, width = 36, height = 18)
        val layer = layout.labelLayer(LabelYaml(text = "1/3"))
        assertEquals(151, layer.x)
        assertEquals(22, layer.y)
        assertEquals(36, layer.width)
        assertEquals(MenuTitleLayer.Alignment.CENTER, layer.alignment)
        assertEquals(8, layer.size)
    }

    @Test fun `alignment, size and offsets move the label inside the rectangle`() {
        val layout = ImageButtonLayout(listOf(0), x = 7, y = 17, width = 54, height = 18)
        assertEquals(9, layout.labelLayer(LabelYaml(text = "a", align = "left")).x)
        assertEquals(59, layout.labelLayer(LabelYaml(text = "a", align = "right")).x)
        val big = layout.labelLayer(LabelYaml(text = "a", size = 12, offsetX = 3, offsetY = -2))
        assertEquals(37, big.x)
        assertEquals(17 + (18 - 10) / 2 - 2, big.y)
        assertEquals(12, big.size)
        assertEquals(8, layout.labelLayer(LabelYaml(text = "a", size = 9)).size)
    }

    @Test fun `the chosen appearance's label becomes a title text over the element`() {
        val yaml = menu("""
            schema: menu/v1
            id: labels
            title: []
            size: 27
            elements:
              - id: claim
                positions: "3-5"
                image: { asset: claim_off, fit: native }
                label: { text: "Locked" }
                states:
                  - if: [{ type: has_level, level: 10 }]
                    image: { asset: claim, fit: native }
                    label: { text: { en: "Claim", fr: "Réclamer" } }
              - id: hover
                positions: 0
                label: { text: "Hi", align: left }
              - id: plain
                positions: 9
                material: STONE
        """)
        val claim = yaml.allElements.first()
        val state = MenuRenderer.labelLayers(yaml, chosen = { el -> if (el === claim) el.states.single() else el.display }, drawn = { true })
        assertEquals(2, state.size)
        val text = state.first() as MenuTitleLayer.Textarea
        assertEquals(mapOf("en" to "Claim", "fr" to "Réclamer"), text.value.localized)
        assertEquals(7 + 3 * 18 + 27, text.x)
        assertEquals(MenuTitleLayer.Alignment.LEFT, (state.last() as MenuTitleLayer.Textarea).alignment)
        val shown = MenuRenderer.labelLayers(yaml, chosen = { it.display }, drawn = { true })
        assertEquals("Locked", (shown.first() as MenuTitleLayer.Textarea).value.key)
    }

    @Test fun `no label over an image that is not drawn, nor on a repeating element`() {
        val yaml = menu("""
            schema: menu/v1
            id: labels
            title: []
            size: 27
            inputs:
              - { name: days, type: list }
            elements:
              - id: claim
                positions: "3-5"
                image: { asset: claim, fit: native }
                label: { text: "Claim" }
              - id: days
                positions: "10-12"
                iterates: { source: days, alias: d }
                label: { text: "x" }
        """)
        assertTrue(MenuRenderer.labelLayers(yaml, chosen = { it.display }, drawn = { false }).isEmpty())
        assertEquals(1, MenuRenderer.labelLayers(yaml, chosen = { it.display }, drawn = { true }).size)
    }

    @Test fun `an element with neither image nor item holds the invisible hit item`() {
        val yaml = menu("""
            schema: menu/v1
            id: hover
            title: []
            size: 27
            elements:
              - id: streak
                positions: "0-2"
                title: Streak
                lore: [ "Longest: 4" ]
              - id: stone
                positions: 9
                material: STONE
        """)
        val player = MockBukkit.getMock()!!.addPlayer()
        val session = MenuRenderer.open(player, MenuCompiler.compile(yaml, emptyMap()), "en")
        for (slot in 0..2) assertNotEquals(Material.STONE, session.slots[slot]?.type ?: Material.AIR)
        assertEquals(Material.STONE, session.slots[9]?.type)
    }

}
