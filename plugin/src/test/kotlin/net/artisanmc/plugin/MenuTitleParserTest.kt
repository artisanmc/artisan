package net.artisanmc.plugin

import net.artisanmc.plugin.engine.MenuTitleParser
import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer
import kotlin.test.*

class MenuTitleParserTest {

    @Test fun `null title yields empty list`() {
        assertEquals(emptyList(), MenuTitleParser.parse(null))
    }

    @Test fun `empty string title yields empty list`() {
        assertEquals(emptyList(), MenuTitleParser.parse(""))
    }

    @Test fun `legacy bare string yields one plain layer`() {
        val result = MenuTitleParser.parse("Shop")
        assertEquals(1, result.size)
        val plain = result.single()
        assertIs<MenuTitleLayer.Plain>(plain)
        assertEquals(LText("Shop", literal = true), plain.value)
        assertNull(plain.color)
    }

    @Test fun `layer value accepts the canonical string form`() {
        val result = MenuTitleParser.parse(
            listOf(mapOf("kind" to "text", "value" to "{i18n:menus.shop.title}", "x" to 8, "y" to 5)),
        )
        val text = result.single() as MenuTitleLayer.Text
        assertEquals(LText("menus.shop.title"), text.value)
    }

    @Test fun `layer value accepts an inline literal string`() {
        val result = MenuTitleParser.parse(listOf(mapOf("kind" to "plain", "value" to "Boutique")))
        assertEquals(LText("Boutique", literal = true), (result.single() as MenuTitleLayer.Plain).value)
    }

    @Test fun `bare string entries in a layer list are plain layers`() {
        val result = MenuTitleParser.parse(
            listOf(
                "{i18n:menus.shop.line1}",
                mapOf("kind" to "glyph", "asset_id" to "a", "x" to 0, "y" to 0),
            ),
        )
        assertEquals(2, result.size)
        assertEquals(LText("menus.shop.line1"), (result[0] as MenuTitleLayer.Plain).value)
        assertIs<MenuTitleLayer.Glyph>(result[1])
    }

    @Test fun `legacy i18n-wrapped string unwraps the bare key into a plain layer`() {
        val result = MenuTitleParser.parse("{i18n:menu.shop.title}")
        val plain = result.single() as MenuTitleLayer.Plain
        assertEquals(LText("menu.shop.title"), plain.value)
    }

    @Test fun `plain kind in array is parsed correctly`() {
        val raw = listOf(
            mapOf("kind" to "plain", "value" to mapOf("key" to "menu.title"), "color" to "#ff0000"),
        )
        val plain = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Plain
        assertEquals(LText("menu.title"), plain.value)
        assertEquals("#ff0000", plain.color)
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
        val yaml = net.artisanmc.plugin.model.MenuYaml(
            id = "m",
            title = "{i18n:menu.shop.title}",
            size = 27,
        )
        val bundle = net.artisanmc.plugin.engine.BundleCompiler.compile(yaml, emptyMap())
        assertEquals(MenuTitleParser.parse("{i18n:menu.shop.title}", "m"), bundle.title)
        assertEquals(1, bundle.title.size)
        val plain = bundle.title.single() as MenuTitleLayer.Plain
        // The menu id yields the canonical address; the key itself is unchanged.
        assertEquals(LText("menu.shop.title", address = "menus.m.title"), plain.value)
    }

    @Test fun `textarea kind parses all fields`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "menu.welcome"),
            "x" to 12,
            "y" to 8,
            "width" to 120,
            "line_height" to 11,
            "alignment" to "center",
            "font_asset_id" to "font_pixel",
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(LText("menu.welcome"), ta.value)
        assertEquals(12, ta.x)
        assertEquals(8, ta.y)
        assertEquals(120, ta.width)
        assertEquals(11, ta.lineHeight)
        assertEquals(MenuTitleLayer.Alignment.CENTER, ta.alignment)
        assertEquals("font_pixel", ta.fontAssetId)
    }

    @Test fun `textarea defaults lineHeight to 10 and alignment to LEFT when absent`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(10, ta.lineHeight)
        assertEquals(MenuTitleLayer.Alignment.LEFT, ta.alignment)
        assertNull(ta.fontAssetId)
    }

    @Test fun `textarea unknown alignment falls back to LEFT`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "alignment" to "junk",
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(MenuTitleLayer.Alignment.LEFT, ta.alignment)
    }

    @Test fun `textarea lineHeight clamps to 1 minimum`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "line_height" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(1, ta.lineHeight)
    }

    @Test fun `textarea lineHeight clamps to 32 maximum`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "line_height" to 999,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(32, ta.lineHeight)
    }

    @Test fun `textarea with missing value yields key empty string (parser leniency)`() {
        val raw = mapOf(
            "kind" to "textarea",
            "x" to 0, "y" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(LText(""), ta.value)
    }

    @Test fun `textarea parses width field`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "width" to 120,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(120, ta.width)
    }

    @Test fun `textarea defaults width to 168 when absent`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(168, ta.width)
    }

    @Test fun `textarea width clamps to 8 minimum`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "width" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(8, ta.width)
    }

    @Test fun `textarea width clamps to 256 maximum`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "width" to 9999,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(256, ta.width)
    }

    @Test
    fun `parses size on text layer`() {
        val src = listOf(
            mapOf("kind" to "text", "value" to mapOf("key" to "k"), "x" to 8, "y" to 5, "size" to 16),
        )
        val layers = MenuTitleParser.parse(src)
        val text = layers.single() as MenuTitleLayer.Text
        assertEquals(16, text.size)
    }

    @Test
    fun `parses size on textarea layer`() {
        val src = listOf(
            mapOf("kind" to "textarea", "value" to mapOf("key" to "k"),
                  "x" to 8, "y" to 20, "width" to 168, "line_height" to 14,
                  "alignment" to "left", "size" to 12),
        )
        val layers = MenuTitleParser.parse(src)
        val ta = layers.single() as MenuTitleLayer.Textarea
        assertEquals(12, ta.size)
    }

    @Test
    fun `text size defaults to 8 when absent`() {
        val src = listOf(mapOf("kind" to "text", "value" to mapOf("key" to "k"), "x" to 8, "y" to 5))
        val text = MenuTitleParser.parse(src).single() as MenuTitleLayer.Text
        assertEquals(8, text.size)
    }

    @Test
    fun `text size falls back to 8 when invalid`() {
        // 10 is not in {4,8,12,16,20,24,32} — parser must reject silently.
        val src = listOf(mapOf("kind" to "text", "value" to mapOf("key" to "k"),
                                "x" to 8, "y" to 5, "size" to 10))
        val text = MenuTitleParser.parse(src).single() as MenuTitleLayer.Text
        assertEquals(8, text.size)
    }

    @Test
    fun `textarea size falls back to 8 when invalid`() {
        val src = listOf(mapOf("kind" to "textarea", "value" to mapOf("key" to "k"),
                                "x" to 8, "y" to 20, "width" to 168, "line_height" to 14,
                                "alignment" to "left", "size" to 999))
        val ta = MenuTitleParser.parse(src).single() as MenuTitleLayer.Textarea
        assertEquals(8, ta.size)
    }

    /**
     * Refs d'assets par NOM (ADR `assets-on-server-disk`, décision 2).
     *
     * `asset: icone_diamant` remplacera `asset_id: ast_9f3c1a` : sur un disque
     * qu'un humain doit pouvoir lire, un id opaque est une énigme. La lecture
     * tolérante arrive AVANT que quoi que ce soit n'écrive la forme nouvelle —
     * la prod doit savoir lire l'après avant d'y être.
     */
    @Test
    fun `un layer accepte la ref par nom comme l'id opaque`() {
        val byName = MenuTitleParser.parse(
            listOf(
                mapOf("kind" to "background", "asset" to "fond_boutique"),
                mapOf("kind" to "glyph", "asset" to "icone_diamant", "x" to 4, "y" to 6),
                mapOf("kind" to "text", "value" to "Boutique", "font" to "pixelmix"),
            )
        )
        assertEquals("fond_boutique", (byName[0] as MenuTitleLayer.Background).assetId)
        assertEquals("icone_diamant", (byName[1] as MenuTitleLayer.Glyph).assetId)
        assertEquals("pixelmix", (byName[2] as MenuTitleLayer.Text).fontAssetId)

        // L'ancienne forme continue d'être lue : la descente n'a pas encore eu
        // lieu, et un Project non migré doit rester ouvrable.
        val byId = MenuTitleParser.parse(
            listOf(mapOf("kind" to "background", "asset_id" to "ast_9f3c1a"))
        )
        assertEquals("ast_9f3c1a", (byId[0] as MenuTitleLayer.Background).assetId)
    }
}
