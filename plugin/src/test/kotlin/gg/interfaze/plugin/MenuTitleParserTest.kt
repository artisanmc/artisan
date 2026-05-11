package gg.interfaze.plugin

import gg.interfaze.plugin.engine.MenuTitleParser
import gg.interfaze.plugin.model.LText
import gg.interfaze.plugin.model.MenuTitleLayer
import kotlin.test.*

class MenuTitleParserTest {

    @Test fun `null title yields empty list`() {
        assertEquals(emptyList(), MenuTitleParser.parse(null))
    }

    @Test fun `empty string title yields empty list`() {
        assertEquals(emptyList(), MenuTitleParser.parse(""))
    }

    @Test fun `legacy bare string yields one text layer at default position`() {
        val result = MenuTitleParser.parse("Shop")
        assertEquals(1, result.size)
        val text = result.single()
        assertIs<MenuTitleLayer.Text>(text)
        assertEquals(LText("Shop"), text.value)
        assertEquals(8, text.x)
        assertEquals(5, text.y)
        assertNull(text.fontAssetId)
        assertNull(text.color)
    }

    @Test fun `legacy i18n-wrapped string unwraps the bare key`() {
        val result = MenuTitleParser.parse("{i18n:menu.shop.title}")
        val text = result.single() as MenuTitleLayer.Text
        assertEquals(LText("menu.shop.title"), text.value)
        assertEquals(8, text.x)
        assertEquals(5, text.y)
    }

    @Test fun `single map is treated as a one-layer list`() {
        val result = MenuTitleParser.parse(
            mapOf("kind" to "background", "asset_id" to "a1")
        )
        assertEquals(listOf(MenuTitleLayer.Background("a1")), result)
    }

    @Test fun `array with all four layer kinds parses each correctly`() {
        val raw = listOf(
            mapOf("kind" to "background", "asset_id" to "a1"),
            mapOf("kind" to "glyph", "asset_id" to "a2", "x" to 10, "y" to 4),
            mapOf(
                "kind" to "text",
                "value" to mapOf("key" to "greeting"),
                "x" to 8,
                "y" to 5,
                "color" to "#ff0000",
            ),
            mapOf(
                "kind" to "external_glyph",
                "provider" to "oraxen",
                "glyph_name" to "my_glyph",
                "x" to 50,
                "y" to 5,
            ),
        )
        val result = MenuTitleParser.parse(raw)
        assertEquals(4, result.size)

        assertEquals(MenuTitleLayer.Background("a1"), result[0])
        assertEquals(MenuTitleLayer.Glyph("a2", 10, 4), result[1])

        val text = result[2] as MenuTitleLayer.Text
        assertEquals(LText("greeting"), text.value)
        assertEquals(8, text.x)
        assertEquals(5, text.y)
        assertEquals("#ff0000", text.color)
        assertNull(text.fontAssetId)

        assertEquals(
            MenuTitleLayer.ExternalGlyph(
                provider = "oraxen",
                glyphName = "my_glyph",
                x = 50,
                y = 5,
            ),
            result[3],
        )
    }

    @Test fun `unknown kind is skipped without throwing`() {
        val raw = listOf(
            mapOf("kind" to "background", "asset_id" to "a1"),
            mapOf("kind" to "future_kind_that_does_not_exist", "asset_id" to "a2"),
            mapOf("kind" to "glyph", "asset_id" to "a3", "x" to 1, "y" to 2),
        )
        val result = MenuTitleParser.parse(raw)
        assertEquals(2, result.size)
        assertEquals(MenuTitleLayer.Background("a1"), result[0])
        assertEquals(MenuTitleLayer.Glyph("a3", 1, 2), result[1])
    }

    @Test fun `text layer with font asset id is captured`() {
        val raw = mapOf(
            "kind" to "text",
            "value" to mapOf("key" to "title.welcome"),
            "x" to 12,
            "y" to 7,
            "font_asset_id" to "font_pixel",
        )
        val text = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Text
        assertEquals(LText("title.welcome"), text.value)
        assertEquals(12, text.x)
        assertEquals(7, text.y)
        assertEquals("font_pixel", text.fontAssetId)
        assertNull(text.color)
    }

    @Test fun `missing numeric coords default to zero`() {
        val raw = mapOf(
            "kind" to "glyph",
            "asset_id" to "a1",
        )
        val glyph = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Glyph
        assertEquals(0, glyph.x)
        assertEquals(0, glyph.y)
    }

    @Test fun `BundleMenu_title field is auto-populated from MenuTitleParser`() {
        // Sanity-check that the data class default `MenuTitleParser.parse(yaml.title)`
        // gives the same result as calling the parser directly.
        val yaml = gg.interfaze.plugin.model.MenuYaml(
            id = "m",
            title = "{i18n:menu.shop.title}",
            size = 27,
        )
        val bundle = gg.interfaze.plugin.engine.BundleCompiler.compile(yaml, emptyMap())
        assertEquals(MenuTitleParser.parse("{i18n:menu.shop.title}"), bundle.title)
        assertEquals(1, bundle.title.size)
        val text = bundle.title.single() as MenuTitleLayer.Text
        assertEquals(LText("menu.shop.title"), text.value)
    }
}
