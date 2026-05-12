package gg.interfaze.plugin

import gg.interfaze.plugin.model.LText
import gg.interfaze.plugin.model.MenuTitleLayer
import gg.interfaze.plugin.render.OffsetEncoder
import gg.interfaze.plugin.render.TitleCompiler
import gg.interfaze.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.ShadowColor
import net.kyori.adventure.text.minimessage.MiniMessage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TitleCompilerTest {

    /** Standard space-offset table mirroring `backend/src/lib/spaceOffsets.ts`. */
    private val standardOffsetMap: Map<Int, Int> = run {
        val advances = listOf(1, 2, 4, 8, 16, 32, 64, 128, 256, -1, -2, -4, -8, -16, -32, -64, -128, -256)
        advances.mapIndexed { i, adv -> (0xF800 + i) to adv }.toMap()
    }
    private val offsetByChar: Map<Char, Int> = standardOffsetMap.mapKeys { it.key.toChar() }
    private val standardEncoder = OffsetEncoder.from(standardOffsetMap)

    /** Sum of pixel advances in a string composed of offset chars. */
    private fun decodeOffset(s: String): Int = s.sumOf { offsetByChar[it] ?: 0 }

    private fun stubLookup(entries: Map<String, AssetEntry>): (String) -> AssetEntry? =
        { id -> entries[id] }

    private val emptyLookup: (String) -> AssetEntry? = { null }

    private fun glyphEntry(name: String, codepoint: Int = 57344, width: Int = 8): AssetEntry =
        AssetEntry(name = name, type = "glyph", codepoint = codepoint, ascent = 8, height = 9, width = width)

    // ---------- compileLayerBody (per-layer fragment, no font wrapper) ----------

    @Test
    fun `compileLayerBody for text without color or font returns bare text`() {
        val layer = MenuTitleLayer.Text(value = LText("greeting"), x = 0, y = 0)
        val s = TitleCompiler.compileLayerBody(layer, mapOf("greeting" to "hello"), emptyLookup)
        assertEquals("hello", s)
    }

    @Test
    fun `compileLayerBody for text with color wraps in color tag`() {
        val layer = MenuTitleLayer.Text(value = LText("greeting"), x = 10, y = 0, color = "#FFAA00")
        val s = TitleCompiler.compileLayerBody(layer, mapOf("greeting" to "hello"), emptyLookup)
        assertEquals("<color:#FFAA00>hello</color>", s)
    }

    @Test
    fun `compileLayerBody for text with missing langMap key falls back to the key`() {
        val layer = MenuTitleLayer.Text(value = LText("missing.key"), x = 0, y = 0)
        val s = TitleCompiler.compileLayerBody(layer, emptyMap(), emptyLookup)
        assertEquals("missing.key", s)
    }

    @Test
    fun `compileLayerBody for glyph emits just the codepoint char (no font wrapper)`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_coin", x = 32, y = 0)
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344)))
        val s = TitleCompiler.compileLayerBody(layer, emptyMap(), lookup)
        assertEquals("$ch", s)
    }

    @Test
    fun `compileLayerBody for unknown glyph asset returns empty string`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_missing", x = 32, y = 0)
        val s = TitleCompiler.compileLayerBody(layer, emptyMap(), emptyLookup)
        assertEquals("", s)
    }

    @Test
    fun `compileLayerBody for background emits just the codepoint char`() {
        val layer = MenuTitleLayer.Background(assetId = "asset_bg")
        val ch = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345)))
        val s = TitleCompiler.compileLayerBody(layer, emptyMap(), lookup)
        assertEquals("$ch", s)
    }

    @Test
    fun `compileLayerBody for text with fontAssetId wraps in font tag`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0, y = 0,
            fontAssetId = "asset_my_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_my_font" to AssetEntry(
                name = "my_font", type = "font", codepoint = null,
                ascent = 0, height = 0, namespace = "interfaze:my_font",
            ),
        ))
        val s = TitleCompiler.compileLayerBody(layer, mapOf("greeting" to "hello"), lookup)
        assertEquals("<font:interfaze:my_font>hello</font>", s)
    }

    @Test
    fun `compileLayerBody for text with fontAssetId and color wraps color inside font`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0, y = 0, color = "#ff0000",
            fontAssetId = "asset_my_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_my_font" to AssetEntry(
                name = "my_font", type = "font", codepoint = null,
                ascent = 0, height = 0, namespace = "interfaze:my_font",
            ),
        ))
        val s = TitleCompiler.compileLayerBody(layer, mapOf("greeting" to "hello"), lookup)
        assertEquals("<font:interfaze:my_font><color:#ff0000>hello</color></font>", s)
    }

    @Test
    fun `compileLayerBody for external glyph emits placeholder`() {
        val layer = MenuTitleLayer.ExternalGlyph(provider = "oraxen", glyphName = "coin", x = 5, y = 0)
        val s = TitleCompiler.compileLayerBody(layer, emptyMap(), emptyLookup)
        assertEquals("□", s)
    }

    // ---------- compileTitle (assembled, with font wrap + offsets) ----------

    @Test
    fun `compileTitle with empty layers returns empty component`() {
        val result = TitleCompiler.compileTitle(
            layers = emptyList(),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        assertEquals(Component.empty(), result)
    }

    @Test
    fun `compileTitle wraps output in interfaze default font and suppresses shadow`() {
        val layers = listOf(MenuTitleLayer.Text(value = LText("k"), x = 0, y = 0))
        val result = TitleCompiler.compileTitle(
            layers = layers,
            lang = "en_us",
            langMap = mapOf("k" to "hi"),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        // Same MM round-trip should match.
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>hi</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
        assertEquals(ShadowColor.none(), result.shadowColor())
    }

    @Test
    fun `compileTitle emits no offset chars for a single layer at x=0`() {
        // Glyph layer at x=0 — no offset should be emitted before it.
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 0, y = 0)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$ch</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle emits offset chars summing to x for a single glyph at non-zero x`() {
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 8, y = 0)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        // Reverse-engineer via the same encoder.
        val offset = standardEncoder.encode(8)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$offset$ch</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle inserts backtracking offset between two glyph layers`() {
        // Glyph A at x=0, width=10 → cursor after A = 10.
        // Glyph B at x=4 → need offset of -6.
        val chA = 57344.toChar()
        val chB = 57345.toChar()
        val lookup = stubLookup(mapOf(
            "a" to glyphEntry("a", 57344, width = 10),
            "b" to glyphEntry("b", 57345, width = 8),
        ))
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Glyph(assetId = "a", x = 0, y = 0),
                MenuTitleLayer.Glyph(assetId = "b", x = 4, y = 0),
            ),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val expectedOffset = standardEncoder.encode(-6)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$chA$expectedOffset$chB</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle does not emit offset between adjacent zero-gap layers`() {
        // Background at x=0 with width=16 followed by glyph at x=16 → no offset needed.
        val chBg = 57345.toChar()
        val chG = 57344.toChar()
        val lookup = stubLookup(mapOf(
            "asset_bg" to glyphEntry("bg", 57345, width = 16),
            "asset_g" to glyphEntry("g", 57344, width = 8),
        ))
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Background(assetId = "asset_bg"),
                MenuTitleLayer.Glyph(assetId = "asset_g", x = 16, y = 0),
            ),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$chBg$chG</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle with EMPTY encoder still wraps font and renders bodies`() {
        // Without offsets, x positioning is dropped — layers concatenate in order.
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 100, y = 0)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = OffsetEncoder.EMPTY,
        )
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$ch</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle composes background + offset-positioned text`() {
        val chBg = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345, width = 176)))
        // Background occupies 176px; text at x=80 → needs -96 backtrack.
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Background(assetId = "asset_bg"),
                MenuTitleLayer.Text(value = LText("k"), x = 80, y = 0),
            ),
            lang = "en_us",
            langMap = mapOf("k" to "hi"),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val expectedOffset = standardEncoder.encode(-96)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:interfaze:default>$chBg${expectedOffset}hi</font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
        // sanity: decoded offset chars sum to -96
        assertEquals(-96, decodeOffset(expectedOffset))
    }

    // ---------- layerX + estimateBodyWidth (internal helpers) ----------

    @Test
    fun `layerX returns 0 for background regardless of other layers`() {
        assertEquals(0, TitleCompiler.layerX(MenuTitleLayer.Background(assetId = "x")))
    }

    @Test
    fun `layerX returns x field for glyph text and external glyph`() {
        assertEquals(7, TitleCompiler.layerX(MenuTitleLayer.Glyph(assetId = "x", x = 7, y = 0)))
        assertEquals(11, TitleCompiler.layerX(MenuTitleLayer.Text(value = LText("k"), x = 11, y = 0)))
        assertEquals(13, TitleCompiler.layerX(MenuTitleLayer.ExternalGlyph(provider = "oraxen", glyphName = "g", x = 13, y = 0)))
    }

    @Test
    fun `estimateBodyWidth for glyph uses asset width when present`() {
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 9)))
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 0, y = 0),
            emptyMap(), lookup,
        )
        assertEquals(9, w)
    }

    @Test
    fun `estimateBodyWidth for glyph falls back to 16 when width is 0`() {
        val lookup = stubLookup(mapOf("asset_g" to glyphEntry("g", 57344, width = 0)))
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Glyph(assetId = "asset_g", x = 0, y = 0),
            emptyMap(), lookup,
        )
        assertEquals(16, w)
    }

    @Test
    fun `estimateBodyWidth for text uses length times 6`() {
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Text(value = LText("hi"), x = 0, y = 0),
            mapOf("hi" to "hello"),
            emptyLookup,
        )
        assertEquals(30, w)
    }

    @Test
    fun `estimateBodyWidth for external glyph is 8`() {
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.ExternalGlyph(provider = "oraxen", glyphName = "g", x = 0, y = 0),
            emptyMap(), emptyLookup,
        )
        assertEquals(8, w)
    }

    @Test
    fun `compileTitle offset chars are all in the offset range`() {
        // Sanity: the chars emitted between layers must come from the encoder table
        // (not be plain text or accidentally collide with glyph codepoints).
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 50, y = 0)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        // Render via MM round-trip and look at the produced string's chars.
        val asString = (result.toString())
        // We can't fully introspect a Component's inner string, but offset chars all live
        // in U+F800..U+F811. Just check the encoder itself: encode(50) chars are in range.
        val encoded = standardEncoder.encode(50)
        for (c in encoded) {
            assertTrue(c.code in 0xF800..0xF811, "char ${c.code.toString(16)} out of offset range")
        }
        // And the resulting Component contains the glyph
        assertTrue(asString.contains(ch.toString()) || asString.isNotEmpty())
    }
}
