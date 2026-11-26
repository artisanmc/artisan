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

    @Test fun `a look of parts draws its images bottom to top and its texts by their anchor`() {
        val yaml = menu("""
            schema: menu/v1
            id: parts
            title: []
            size: 27
            elements:
              - id: buy
                positions: "0-2"
                parts:
                  - image: panel
                  - image: coin
                    anchor: left
                    offset_x: 3
                  - label: Buy
                  - label: "{price}"
                    anchor: top_right
                    size: 12
                    offset_x: -4
              - id: both
                positions: "9-11"
                image: { asset: coin }
                label: { text: "ignored" }
                parts:
                  - image: panel
        """)
        val buy = yaml.allElements.first { it.id == "buy" }
        val layout = ImageButtonLayout.rectangle(yaml, buy)!!
        val images = buy.display.images
        assertEquals(listOf("panel", "coin"), images.map { it.asset })
        assertEquals(listOf("native", "native"), images.map { it.fit })
        // The key the pack builder writes (`imageButtonKey`): the anchor after the offsets, the centre unnamed.
        assertTrue(layout.assetKey(images[0]).endsWith("_54_18_native_17"))
        assertTrue(layout.assetKey(images[1]).endsWith("_54_18_native_17_3_0_left"))

        val labels = MenuRenderer.labelLayers(yaml, chosen = { it.display }, drawn = { it == layout.assetKey(images[0]) })
            .filterIsInstance<MenuTitleLayer.Textarea>()
        assertEquals(2, labels.size)
        assertEquals(MenuTitleLayer.Alignment.CENTER, labels[0].alignment)
        assertEquals(22, labels[0].y)
        assertEquals(MenuTitleLayer.Alignment.RIGHT, labels[1].alignment)
        assertEquals(7 + 54 - 2 - 4, labels[1].x)
        assertEquals(17 + 2, labels[1].y)
        assertEquals(12, labels[1].size)
        // No text over a look none of whose images is drawn.
        assertTrue(MenuRenderer.labelLayers(yaml, chosen = { it.display }, drawn = { false }).isEmpty())

        // Parts win over an image and a label written beside them.
        val both = yaml.allElements.first { it.id == "both" }
        assertEquals(listOf("panel"), both.display.images.map { it.asset })
        assertTrue(both.display.labels.isEmpty())
    }

    @Test fun `a text piece at the bottom sits on the rectangle's last rows`() {
        val layout = ImageButtonLayout(listOf(0), x = 7, y = 17, width = 54, height = 36)
        assertEquals(17 + 36 - 7 - 2, layout.labelLayer(LabelYaml(text = "a", valign = "bottom")).y)
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
