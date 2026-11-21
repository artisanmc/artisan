package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.artisanmc.plugin.model.ImageButtonYaml
import net.artisanmc.plugin.render.menu.ImageButtonLayout
import org.bukkit.Material
import kotlin.test.*

class MenuRendererImageButtonTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `an image is drawn once and all six slots have the same click actions`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: image
            title: []
            size: 27
            elements:
              - id: buy
                positions: "0-2,9-11"
                image: { asset: buy, fit: stretch }
                title: Buy
                click:
                  left: 'send_message "Bought"'
        """.trimIndent())
        val player = MockBukkit.getMock()!!.addPlayer()
        val lookups = mutableSetOf<String>()
        val session = MenuRenderer.open(player, MenuCompiler.compile(yaml, emptyMap()), "en",
            lookupAsset = { key ->
                lookups.add(key)
                AssetEntry(key, "glyph", 0xe000, -4, 36, 54, "artisan:$key")
            })
        assertEquals(setOf(0, 1, 2, 9, 10, 11), session.activeClicks.keys)
        assertEquals(1, lookups.filter { it.startsWith("buttons/") }.size)
        for (slot in session.activeClicks.keys) {
            assertNotEquals(Material.STONE, session.slots[slot]?.type)
        }
        assertNull(session.slots[3])
    }

    @Test fun `a conditional state replaces the image and the click map across every slot`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: image
            title: []
            size: 27
            elements:
              - id: buy
                positions: "0-2,9-11"
                image: { asset: buy }
                click: { left: 'send_message "Normal"' }
                states:
                  - if: [{ type: has_level, level: 10 }]
                    image: { asset: vip }
                    click: { right: 'send_message "VIP"' }
        """.trimIndent())
        val player = MockBukkit.getMock()!!.addPlayer()
        val menu = MenuCompiler.compile(yaml, emptyMap())
        val layout = ImageButtonLayout.of(yaml, yaml.allElements.single())!!
        for ((level, asset, click) in listOf(Triple(0, "buy", ClickType.LEFT), Triple(10, "vip", ClickType.RIGHT))) {
            player.level = level
            val keys = mutableSetOf<String>()
            val session = MenuRenderer.open(player, menu, "en", lookupAsset = { key ->
                keys.add(key); AssetEntry(key, "glyph", 0xe000, -4, 36, 54, "artisan:$key")
            })
            assertEquals(setOf(layout.assetKey(ImageButtonYaml(asset))), keys)
            assertEquals(setOf(0, 1, 2, 9, 10, 11), session.activeClicks.keys)
            session.activeClicks.values.forEach { assertEquals(setOf(click), it.keys) }
        }
        val missing = MenuRenderer.open(player, menu, "en")
        assertTrue(missing.activeClicks.isEmpty(), "Missing image must not leave an invisible active button")
    }

    @Test fun `invalid rectangles and overlaps have no active image button`() {
        for (positions in listOf("0,2", "25-28", "0-2,9-11")) {
            val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
                schema: menu/v1
                id: image
                size: 27
                elements:
                  - id: buy
                    positions: "$positions"
                    image: { asset: buy }
                    click: { left: 'send_message "Normal"' }
                  - id: other
                    positions: 10
                    material: DIAMOND
            """.trimIndent())
            val player = MockBukkit.getMock()!!.addPlayer()
            val session = MenuRenderer.open(player, MenuCompiler.compile(yaml, emptyMap()), "en",
                lookupAsset = { key -> AssetEntry(key, "glyph", 0xe000, -4, 36, 54, "artisan:$key") })
            assertTrue(session.activeClicks.isEmpty())
            assertEquals(Material.DIAMOND, session.slots[10]?.type)
        }
    }

    @Test fun `an iterating element draws one image per slot, chosen per row, else its material`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: calendar
            title: []
            size: 27
            inputs:
              - { name: days, type: list }
            elements:
              - id: days
                positions: "10-12"
                iterates: { source: days, alias: d }
                states:
                  - if: [{ expression: d.claimed }]
                    image: { asset: claimed, fit: stretch }
                    material: GRAY_DYE
                    title: Claimed
                    click: { left: 'send_message "done"' }
                  - if: [{ expression: "!d.claimed" }]
                    image: { asset: ghost }
                material: STONE
        """.trimIndent())
        val player = MockBukkit.getMock()!!.addPlayer()
        val menu = MenuCompiler.compile(yaml, emptyMap())
        val days = listOf(mapOf("claimed" to true), mapOf("claimed" to true), mapOf("claimed" to false))
        val ctx = ExecutionContext(player, args = mapOf("days" to days))
        val slotKey = { slot: Int, asset: String -> ImageButtonLayout.slot(yaml, slot)!!.assetKey(ImageButtonYaml(asset, "stretch")) }
        // Slots 10 and 11 share a row: one glyph key, asked for each slot; slot 12's image
        // has no material to fall back on, so a missing image leaves it empty.
        val keys = mutableListOf<String>()
        val session = MenuRenderer.open(player, menu, "en", ctx, lookupAsset = { key ->
            keys.add(key)
            if (key.startsWith("buttons/") && key == slotKey(10, "claimed")) AssetEntry(key, "glyph", 0xe000, -4, 18, 18, "artisan:$key") else null
        })
        assertEquals(slotKey(10, "claimed"), slotKey(11, "claimed"))
        assertEquals(2, keys.count { it == slotKey(10, "claimed") })
        assertEquals(setOf(10, 11), session.activeClicks.keys)
        assertNotEquals(Material.GRAY_DYE, session.slots[10]?.type)
        assertNull(session.slots[12])
        // Without the pack: the claimed rows show their material, clicks kept.
        val plain = MenuRenderer.open(player, menu, "en", ctx)
        assertEquals(Material.GRAY_DYE, plain.slots[10]?.type)
        assertEquals(Material.GRAY_DYE, plain.slots[11]?.type)
        assertEquals(setOf(10, 11), plain.activeClicks.keys)
        // A Bedrock player never gets the images, even with the asset known.
        val bedrock = MenuRenderer.open(player, menu, "en", ctx,
            lookupAsset = { key -> AssetEntry(key, "glyph", 0xe000, -4, 18, 18, "artisan:$key") },
            bedrock = { true })
        assertEquals(Material.GRAY_DYE, bedrock.slots[10]?.type)
    }
}
