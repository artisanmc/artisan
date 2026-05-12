package gg.interfaze.plugin

import gg.interfaze.plugin.model.LText
import gg.interfaze.plugin.model.MenuTitleLayer
import gg.interfaze.plugin.render.TitleCompiler
import gg.interfaze.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.ShadowColor
import kotlin.test.Test
import kotlin.test.assertEquals

class TitleCompilerTest {

    private fun stubLookup(entries: Map<String, AssetEntry>): (String) -> AssetEntry? =
        { id -> entries[id] }

    private val emptyLookup: (String) -> AssetEntry? = { null }

    private fun glyphEntry(name: String, codepoint: Int = 57344): AssetEntry =
        AssetEntry(name = name, type = "glyph", codepoint = codepoint, ascent = 8, height = 9)

    @Test
    fun `compileTitle with empty layers returns empty component`() {
        val result = TitleCompiler.compileTitle(
            layers = emptyList(),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = emptyLookup,
        )
        assertEquals(Component.empty(), result)
    }

    @Test
    fun `text layer emits color tag (offset dropped)`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 10,
            y = 0,
            color = "#FFAA00",
        )
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), emptyLookup)
        assertEquals("<color:#FFAA00>hello</color>", s)
    }

    @Test
    fun `text layer at x=0 with color emits color tag only`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0,
            y = 0,
            color = "#FFAA00",
        )
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), emptyLookup)
        assertEquals("<color:#FFAA00>hello</color>", s)
    }

    @Test
    fun `text layer without color renders bare text (offset dropped)`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 10,
            y = 0,
            color = null,
        )
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), emptyLookup)
        assertEquals("hello", s)
    }

    @Test
    fun `text layer with missing langMap key falls back to the key`() {
        val layer = MenuTitleLayer.Text(
            value = LText("missing.key"),
            x = 0,
            y = 0,
            color = null,
        )
        val s = TitleCompiler.compileLayer(layer, emptyMap(), emptyLookup)
        assertEquals("missing.key", s)
    }

    @Test
    fun `glyph layer emits font tag with codepoint char (offset dropped)`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_coin", x = 32, y = 0)
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344)))
        val s = TitleCompiler.compileLayer(layer, emptyMap(), lookup)
        assertEquals("<font:interfaze:default>$ch</font>", s)
    }

    @Test
    fun `glyph layer output is independent of x offset`() {
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344)))
        val sAtZero = TitleCompiler.compileLayer(
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 0, y = 0),
            emptyMap(),
            lookup,
        )
        val sAtHundred = TitleCompiler.compileLayer(
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 100, y = 0),
            emptyMap(),
            lookup,
        )
        assertEquals(sAtZero, sAtHundred)
    }

    @Test
    fun `glyph layer with unknown asset id returns empty string`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_missing", x = 32, y = 0)
        val s = TitleCompiler.compileLayer(layer, emptyMap(), emptyLookup)
        assertEquals("", s)
    }

    @Test
    fun `glyph layer with asset that has null codepoint returns empty string`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_texture", x = 32, y = 0)
        val lookup = stubLookup(mapOf(
            "asset_texture" to AssetEntry(name = "tex", type = "texture", codepoint = null, ascent = 0, height = 0),
        ))
        val s = TitleCompiler.compileLayer(layer, emptyMap(), lookup)
        assertEquals("", s)
    }

    @Test
    fun `background layer renders font tag without offset wrapper`() {
        val layer = MenuTitleLayer.Background(assetId = "asset_bg")
        val ch = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345)))
        val s = TitleCompiler.compileLayer(layer, emptyMap(), lookup)
        assertEquals("<font:interfaze:default>$ch</font>", s)
    }

    @Test
    fun `background layer with unknown asset id returns empty string`() {
        val layer = MenuTitleLayer.Background(assetId = "asset_missing")
        val s = TitleCompiler.compileLayer(layer, emptyMap(), emptyLookup)
        assertEquals("", s)
    }

    @Test
    fun `external glyph layer falls back to bare placeholder (offset dropped)`() {
        val layer = MenuTitleLayer.ExternalGlyph(
            provider = "oraxen",
            glyphName = "coin",
            x = 5,
            y = 0,
        )
        val s = TitleCompiler.compileLayer(layer, emptyMap(), emptyLookup)
        assertEquals("□", s)
    }

    @Test
    fun `external glyph layer at x=0 emits bare placeholder`() {
        val layer = MenuTitleLayer.ExternalGlyph(
            provider = "oraxen",
            glyphName = "coin",
            x = 0,
            y = 0,
        )
        val s = TitleCompiler.compileLayer(layer, emptyMap(), emptyLookup)
        assertEquals("□", s)
    }

    @Test
    fun `text layer with fontAssetId resolving to a font asset emits font tag`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0,
            y = 0,
            color = null,
            fontAssetId = "asset_my_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_my_font" to AssetEntry(
                name = "my_font",
                type = "font",
                codepoint = null,
                ascent = 0,
                height = 0,
                namespace = "interfaze:my_font",
            ),
        ))
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), lookup)
        assertEquals("<font:interfaze:my_font>hello</font>", s)
    }

    @Test
    fun `text layer with fontAssetId missing from catalog falls back to bare text`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0,
            y = 0,
            color = null,
            fontAssetId = "asset_missing",
        )
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), emptyLookup)
        assertEquals("hello", s)
    }

    @Test
    fun `text layer with fontAssetId resolving to non-font asset falls back to bare text`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0,
            y = 0,
            color = null,
            fontAssetId = "asset_not_a_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_not_a_font" to AssetEntry(
                name = "coin",
                type = "glyph",
                codepoint = 57344,
                ascent = 8,
                height = 9,
                namespace = "interfaze:default",
            ),
        ))
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), lookup)
        assertEquals("hello", s)
    }

    @Test
    fun `text layer with font and color wraps color inside font`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0,
            y = 0,
            color = "#ff0000",
            fontAssetId = "asset_my_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_my_font" to AssetEntry(
                name = "my_font",
                type = "font",
                codepoint = null,
                ascent = 0,
                height = 0,
                namespace = "interfaze:my_font",
            ),
        ))
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), lookup)
        assertEquals("<font:interfaze:my_font><color:#ff0000>hello</color></font>", s)
    }

    @Test
    fun `text layer with font emits only font tag (offset dropped)`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 12,
            y = 0,
            color = null,
            fontAssetId = "asset_my_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_my_font" to AssetEntry(
                name = "my_font",
                type = "font",
                codepoint = null,
                ascent = 0,
                height = 0,
                namespace = "interfaze:my_font",
            ),
        ))
        val s = TitleCompiler.compileLayer(layer, mapOf("greeting" to "hello"), lookup)
        assertEquals("<font:interfaze:my_font>hello</font>", s)
    }

    @Test
    fun `compileTitle concatenates layers in order and renders to a Component`() {
        val layers = listOf(
            MenuTitleLayer.Background(assetId = "asset_bg"),
            MenuTitleLayer.Text(value = LText("greeting"), x = 8, y = 5, color = null),
        )
        val ch = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345)))

        val result = TitleCompiler.compileTitle(
            layers = layers,
            lang = "en_us",
            langMap = mapOf("greeting" to "hello"),
            lookupAsset = lookup,
        )

        // Same MiniMessage round-trip should produce an equal Component.
        // Offset is dropped (see TitleCompiler KDoc) — layers concatenate in order.
        // Shadow is suppressed on the root (see TitleCompiler.compileTitle).
        val expected = net.kyori.adventure.text.minimessage.MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$ch</font>hello")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle suppresses default text shadow on the root component`() {
        val layers = listOf(
            MenuTitleLayer.Text(value = LText("greeting"), x = 0, y = 0, color = null),
        )
        val result = TitleCompiler.compileTitle(
            layers = layers,
            lang = "en_us",
            langMap = mapOf("greeting" to "hello"),
            lookupAsset = emptyLookup,
        )
        assertEquals(ShadowColor.none(), result.shadowColor())
    }

    @Test
    fun `compileTitle suppresses shadow even with a single glyph layer`() {
        val ch = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Background(assetId = "asset_bg")),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
        )
        assertEquals(ShadowColor.none(), result.shadowColor())
        // sanity: still actually contains the glyph
        assertEquals(true, result.toString().contains(ch.toString()))
    }
}
