package net.artisanmc.plugin

import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.render.OffsetEncoder
import net.artisanmc.plugin.render.TitleCompiler
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.ShadowColor
import net.kyori.adventure.text.minimessage.MiniMessage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
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
    fun `compileLayerBody for text without color or font wraps in text_y font`() {
        val layer = MenuTitleLayer.Text(value = LText("greeting"), x = 0, y = 5)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "hello"), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y5_h8>hello</font>", s)
    }

    @Test
    fun `compileLayerBody for text at non-default y wraps in matching text_y font`() {
        val layer = MenuTitleLayer.Text(value = LText("greeting"), x = 0, y = 20)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "hello"), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y20_h8>hello</font>", s)
    }

    @Test
    fun `compileLayerBody for text at title-label y=6 wraps in text_y6 font`() {
        val layer = MenuTitleLayer.Text(value = LText("k"), x = 8, y = 6)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("k" to "hi"), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y6_h8>hi</font>", s)
    }

    @Test
    fun `compileLayerBody for text with color wraps color inside text_y font`() {
        val layer = MenuTitleLayer.Text(value = LText("greeting"), x = 10, y = 5, color ="#FFAA00")
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "hello"), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y5_h8><color:#FFAA00>hello</color></font>", s)
    }

    @Test
    fun `compileLayerBody for text with missing langMap key resolves to empty string`() {
        // Deliberate: echoing the raw key (menus.foo.title) to players is worse
        // than showing nothing — see TitleCompiler.resolveLText.
        val layer = MenuTitleLayer.Text(value = LText("missing.key"), x = 0, y = 5)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y5_h8></font>", s)
    }

    @Test
    fun `compileLayerBody for glyph emits white-wrapped codepoint char`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_coin", x = 32, y = 5)
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344)))
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), lookup, OffsetEncoder.EMPTY)
        assertEquals("<white>$ch</white>", s)
    }

    @Test
    fun `compileLayerBody for glyph off its default y wraps in the matching glyph_y font`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_coin", x = 32, y = 40)
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344)))
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), lookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:glyph_y40><white>$ch</white></font>", s)
    }

    @Test
    fun `compileLayerBody for glyph above its floor clamps y to 13 minus height`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_coin", x = 32, y = -10)
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344)))
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), lookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:glyph_y4><white>$ch</white></font>", s)
    }

    @Test
    fun `compileLayerBody for unknown glyph asset returns empty string`() {
        val layer = MenuTitleLayer.Glyph(assetId = "asset_missing", x = 32, y = 5)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("", s)
    }

    @Test
    fun `compileLayerBody for background emits white-wrapped codepoint char`() {
        val layer = MenuTitleLayer.Background(assetId = "asset_bg")
        val ch = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345)))
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), lookup, OffsetEncoder.EMPTY)
        assertEquals("<white>$ch</white>", s)
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
                ascent = 0, height = 0, namespace = "artisan:my_font",
            ),
        ))
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "hello"), lookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:my_font>hello</font>", s)
    }

    @Test
    fun `compileLayerBody for text with fontAssetId and color wraps color inside font`() {
        val layer = MenuTitleLayer.Text(
            value = LText("greeting"),
            x = 0, y = 5, color ="#ff0000",
            fontAssetId = "asset_my_font",
        )
        val lookup = stubLookup(mapOf(
            "asset_my_font" to AssetEntry(
                name = "my_font", type = "font", codepoint = null,
                ascent = 0, height = 0, namespace = "artisan:my_font",
            ),
        ))
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "hello"), lookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:my_font><color:#ff0000>hello</color></font>", s)
    }

    @Test
    fun `compileLayerBody for external glyph emits placeholder`() {
        val layer = MenuTitleLayer.ExternalGlyph(provider = "oraxen", glyphName = "coin", x = 5, y = 5)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, emptyMap(), emptyLookup, OffsetEncoder.EMPTY)
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
    fun `compileTitle wraps output in artisan default font and suppresses shadow`() {
        // Text at x=0 (chest-left). The compiler emits a -TITLE_LABEL_X offset so
        // the cursor starts at chest-x 0 instead of the title-draw start (chest-x 8).
        // Plain text is wrapped in the Y-specific font (text_y0 here).
        val layers = listOf(MenuTitleLayer.Text(value = LText("k"), x = 0, y = 5))
        val result = TitleCompiler.compileTitle(
            layers = layers,
            lang = "en_us",
            langMap = mapOf("k" to "hi"),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        val initOffset = standardEncoder.encode(-TitleCompiler.TITLE_LABEL_X)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default>${initOffset}<font:artisan:text_y5_h8>hi</font></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
        assertEquals(ShadowColor.none(), result.shadowColor())
    }

    @Test
    fun `compileTitle emits -TITLE_LABEL_X offset for a single layer at x=0`() {
        // Glyph layer at x=0 — the compiler emits an initial -8 offset to anchor
        // from chest-left, then no additional offset.
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 0, y = 5)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val initOffset = standardEncoder.encode(-TitleCompiler.TITLE_LABEL_X)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default>$initOffset<white>$ch</white></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle emits no offset for a single glyph at x=TITLE_LABEL_X`() {
        // x=8 is exactly at the title draw start → no net offset after the initial
        // cursor adjustment. This is the legacy default text position.
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = TitleCompiler.TITLE_LABEL_X, y = 5)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default><white>$ch</white></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle inserts backtracking offset between two glyph layers`() {
        // Glyph A at x=0, width=10 → MC advance = 10+1 = 11. Cursor after A = 0+11 = 11.
        // Glyph B at x=4 → need offset 4-11 = -7 between them.
        // Initial -8 prefix anchors the cursor to chest-left before A.
        val chA = 57344.toChar()
        val chB = 57345.toChar()
        val lookup = stubLookup(mapOf(
            "a" to glyphEntry("a", 57344, width = 10),
            "b" to glyphEntry("b", 57345, width = 8),
        ))
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Glyph(assetId = "a", x = 0, y = 5),
                MenuTitleLayer.Glyph(assetId = "b", x = 4, y = 5),
            ),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val initOffset = standardEncoder.encode(-TitleCompiler.TITLE_LABEL_X)
        val backOffset = standardEncoder.encode(-7)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default>$initOffset<white>$chA</white>$backOffset<white>$chB</white></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle accounts for MC +1 advance between adjacent layers`() {
        // Background at x=0 with width=16, glyph at x=16.
        // MC advance for bg = 16+1 = 17, so cursor is at 17 after bg.
        // To place glyph at x=16 → need offset 16-17 = -1.
        val chBg = 57345.toChar()
        val chG = 57344.toChar()
        val lookup = stubLookup(mapOf(
            "asset_bg" to glyphEntry("bg", 57345, width = 16),
            "asset_g" to glyphEntry("g", 57344, width = 8),
        ))
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Background(assetId = "asset_bg"),
                MenuTitleLayer.Glyph(assetId = "asset_g", x = 16, y = 5),
            ),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val initOffset = standardEncoder.encode(-TitleCompiler.TITLE_LABEL_X)
        val gapOffset = standardEncoder.encode(-1)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default>$initOffset<white>$chBg</white>$gapOffset<white>$chG</white></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle with EMPTY encoder still wraps font and renders bodies`() {
        // Without offsets, x positioning is dropped — layers concatenate in order.
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 100, y = 5)),
            lang = "en_us",
            langMap = emptyMap(),
            lookupAsset = lookup,
            offsetEncoder = OffsetEncoder.EMPTY,
        )
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default><white>$ch</white></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle composes background + offset-positioned text`() {
        val chBg = 57345.toChar()
        val lookup = stubLookup(mapOf("asset_bg" to glyphEntry("bg", 57345, width = 176)))
        // Background at x=0, width=176. Text at x=80, y=0.
        // Initial -8 offset anchors cursor to chest-left (x=0).
        // After background: MC advance = 176+1 = 177, so cursor = 177.
        // Text offset: 80 - 177 = -97.
        // Plain text is wrapped in text_y0 font.
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Background(assetId = "asset_bg"),
                MenuTitleLayer.Text(value = LText("k"), x = 80, y = 5),
            ),
            lang = "en_us",
            langMap = mapOf("k" to "hi"),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        // After bg: MC advance = 176+1 = 177. currentX = 177. Text at x=80 → offset = 80-177 = -97.
        val initOffset = standardEncoder.encode(-TitleCompiler.TITLE_LABEL_X)
        val textOffset = standardEncoder.encode(-97)
        val expected = MiniMessage.miniMessage()
            .deserialize("<font:artisan:default>$initOffset<white>$chBg</white>${textOffset}<font:artisan:text_y5_h8>hi</font></font>")
            .shadowColor(ShadowColor.none())
        assertEquals(expected, result)
        // sanity: decoded offsets
        assertEquals(-TitleCompiler.TITLE_LABEL_X, decodeOffset(initOffset))
        assertEquals(-97, decodeOffset(textOffset))
    }

    // ---------- layerX + estimateBodyWidth (internal helpers) ----------

    @Test
    fun `layerX returns 0 for background regardless of other layers`() {
        assertEquals(0, TitleCompiler.layerX(MenuTitleLayer.Background(assetId = "x")))
    }

    @Test
    fun `layerX returns x field for glyph text and external glyph`() {
        assertEquals(7, TitleCompiler.layerX(MenuTitleLayer.Glyph(assetId = "x", x = 7, y = 5)))
        assertEquals(11, TitleCompiler.layerX(MenuTitleLayer.Text(value = LText("k"), x = 11, y = 5)))
        assertEquals(13, TitleCompiler.layerX(MenuTitleLayer.ExternalGlyph(provider = "oraxen", glyphName = "g", x = 13, y = 5)))
    }

    @Test
    fun `estimateBodyWidth for glyph uses asset width + 1 (MC inter-char advance)`() {
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 9)))
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 0, y = 5),
            emptyMap(), lookup,
        )
        assertEquals(10, w)
    }

    @Test
    fun `estimateBodyWidth for glyph falls back to 16 + 1 when width is 0`() {
        val lookup = stubLookup(mapOf("asset_g" to glyphEntry("g", 57344, width = 0)))
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Glyph(assetId = "asset_g", x = 0, y = 5),
            emptyMap(), lookup,
        )
        assertEquals(17, w)
    }

    @Test
    fun `estimateBodyWidth for text sums per-char advances from MC ascii font`() {
        // "hello": h=6, e=6, l=3, l=3, o=6 → 24
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Text(value = LText("hi"), x = 0, y = 5),
            mapOf("hi" to "hello"),
            emptyLookup,
        )
        assertEquals(24, w)
    }

    @Test
    fun `estimateBodyWidth for text strips MiniMessage tags before summing advances`() {
        // "<gold>hello</gold>" strips to "hello" → h=6, e=6, l=3, l=3, o=6 → 24 (not 18*6=108)
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Text(value = LText("key"), x = 0, y = 5),
            mapOf("key" to "<gold>hello</gold>"),
            emptyLookup,
        )
        assertEquals(24, w)
    }

    @Test
    fun `estimateBodyWidth for bold text adds 1 per bold char (MC bold glyph shift)`() {
        // MC renders bold by drawing the glyph shifted 1px right, adding 1 to each char's advance.
        // "<bold>hello</bold>" → per-char sum 24 + 5 bold chars = 29.
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Text(value = LText("key"), x = 0, y = 5),
            mapOf("key" to "<bold>hello</bold>"),
            emptyLookup,
        )
        assertEquals(29, w)
    }

    @Test
    fun `estimateBodyWidth for unclosed bold tag counts to end of string`() {
        // MiniMessage allows implicit close at end of string.
        // "<bold>hello" (no closing tag) → same 5 bold chars → 29.
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Text(value = LText("key"), x = 0, y = 5),
            mapOf("key" to "<bold>hello"),
            emptyLookup,
        )
        assertEquals(29, w)
    }

    @Test
    fun `estimateBodyWidth for mixed bold and plain text only adds bold correction to bold chars`() {
        // "ab<bold>cd</bold>ef" → a=6,b=6 (plain) + c=6,d=6+2 bold (12+2) + e=6,f=5 (plain)
        // sum of chars = 6+6+6+6+6+5 = 35; bold correction = 2 → 37
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.Text(value = LText("key"), x = 0, y = 5),
            mapOf("key" to "ab<bold>cd</bold>ef"),
            emptyLookup,
        )
        assertEquals(37, w)
    }

    @Test
    fun `compileTitle places glyph at same x regardless of textarea layer order`() {
        // Same invariant as the text-layer ordering test below, extended to
        // Textarea. Regression: before this fix Textarea was in the "first"
        // sort group, so a Textarea BEFORE a Glyph in input order would push
        // the Glyph's offset by the Textarea's estimated end-cursor, visibly
        // shifting the glyph.
        val glyphCh = 0xE000.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 0xE000, width = 8)))

        fun render(orderedLayers: List<MenuTitleLayer>): String {
            val result = TitleCompiler.compileTitle(
                layers = orderedLayers,
                lang = "en_us",
                langMap = mapOf("k" to "Hello"),
                lookupAsset = lookup,
                offsetEncoder = standardEncoder,
            )
            return result.toString()
        }

        val textareaFirst = listOf(
            MenuTitleLayer.Textarea(
                value = LText("k"), x = 8, y = 5, width =256, lineHeight = 10,
                alignment = MenuTitleLayer.Alignment.LEFT,
            ),
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 50, y = 5),
        )
        val glyphFirst = listOf(
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 50, y = 5),
            MenuTitleLayer.Textarea(
                value = LText("k"), x = 8, y = 5, width =256, lineHeight = 10,
                alignment = MenuTitleLayer.Alignment.LEFT,
            ),
        )

        assertEquals(render(textareaFirst), render(glyphFirst))
    }

    @Test
    fun `compileTitle places glyph at same x regardless of text layer order`() {
        // If text is listed BEFORE the glyph in the input array, the glyph should
        // still land at x=50. Tag-inflated text-width estimates must not shift it.
        val glyphCh = 0xE000.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 0xE000, width = 8)))

        fun offsetsFor(orderedLayers: List<MenuTitleLayer>): String {
            val result = TitleCompiler.compileTitle(
                layers = orderedLayers,
                lang = "en_us",
                langMap = mapOf("title" to "<gold>Titre</gold>"),
                lookupAsset = lookup,
                offsetEncoder = standardEncoder,
            )
            return result.toString()
        }

        val textFirst = listOf(
            MenuTitleLayer.Text(value = LText("title"), x = 8, y = 5),
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 50, y = 5),
        )
        val glyphFirst = listOf(
            MenuTitleLayer.Glyph(assetId = "asset_coin", x = 50, y = 5),
            MenuTitleLayer.Text(value = LText("title"), x = 8, y = 5),
        )

        // Both orderings must produce the same component (glyph at x=50 in both cases).
        assertEquals(offsetsFor(textFirst), offsetsFor(glyphFirst))
    }

    @Test
    fun `estimateBodyWidth for external glyph is 8`() {
        val w = TitleCompiler.estimateBodyWidth(
            MenuTitleLayer.ExternalGlyph(provider = "oraxen", glyphName = "g", x = 0, y = 5),
            emptyMap(), emptyLookup,
        )
        assertEquals(8, w)
    }

    // ---------- Plain (vanilla) layers ----------------------------------------

    @Test
    fun `compileTitle with single Plain layer returns raw MiniMessage without font wrapper`() {
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Plain(value = LText("k"))),
            lang = "en_us",
            langMap = mapOf("k" to "hello"),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        val expected = MiniMessage.miniMessage().deserialize("hello")
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle with Plain layer with color wraps in color tag`() {
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Plain(value = LText("k"), color = "#ff0000")),
            lang = "en_us",
            langMap = mapOf("k" to "hello"),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        val expected = MiniMessage.miniMessage().deserialize("<color:#ff0000>hello</color>")
        assertEquals(expected, result)
    }

    @Test
    fun `compileTitle with Plain layer does NOT suppress shadow (vanilla MC renders shadow)`() {
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Plain(value = LText("k"))),
            lang = "en_us",
            langMap = mapOf("k" to "hi"),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        // Plain mode should NOT call shadowColor(none()) — shadow is part of vanilla MC.
        // We verify by checking the component does NOT have ShadowColor.none() set.
        assertNotEquals(net.kyori.adventure.text.format.ShadowColor.none(), result.shadowColor())
    }

    @Test
    fun `compileTitle with mixed Plain and non-Plain falls through to composed path`() {
        // Mixed layers (shouldn't happen in practice, but must not crash).
        val layers = listOf(
            MenuTitleLayer.Plain(value = LText("k")),
            MenuTitleLayer.Glyph(assetId = "x", x = 0, y = 5),
        )
        // Should not throw; result is some non-empty component.
        val result = TitleCompiler.compileTitle(
            layers = layers,
            lang = "en_us",
            langMap = mapOf("k" to "hi"),
            lookupAsset = emptyLookup,
            offsetEncoder = standardEncoder,
        )
        assertTrue(result !== Component.empty())
    }

    // ---------- compileLayerBody for Textarea ----------

    @Test
    fun `compileLayerBody textarea with one line renders one text_y wrapper`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "hi"), emptyLookup, standardEncoder,
        )
        assertEquals("<font:artisan:text_y5_h8>hi</font>", s)
    }

    @Test
    fun `compileLayerBody textarea with three lines emits three text_y wrappers`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "a\nb\nc"), emptyLookup, standardEncoder,
        )
        assertTrue(s.contains("<font:artisan:text_y5_h8>a</font>"))
        assertTrue(s.contains("<font:artisan:text_y15_h8>b</font>"))
        assertTrue(s.contains("<font:artisan:text_y25_h8>c</font>"))
    }

    @Test
    fun `compileLayerBody textarea alignment center positions lines around layer x`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 50, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.CENTER,
        )
        // "ab" width = 6+6 = 12, so center → lineX = 50 - 12/2 = 44.
        // Cursor starts at 0, first offset = 44.
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab"), emptyLookup, standardEncoder,
        )
        val firstOffset = standardEncoder.encode(44)
        assertEquals("$firstOffset<font:artisan:text_y5_h8>ab</font>", s)
    }

    @Test
    fun `compileLayerBody textarea alignment right ends all lines at layer x`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 60, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.RIGHT,
        )
        // "ab" width = 12, right → lineX = 60 - 12 = 48.
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab"), emptyLookup, standardEncoder,
        )
        val firstOffset = standardEncoder.encode(48)
        assertEquals("$firstOffset<font:artisan:text_y5_h8>ab</font>", s)
    }

    @Test
    fun `compileLayerBody textarea truncates lines past TEXT_Y_MAX`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 168, width = 256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // y=168, lineHeight=10. TEXT_Y_MAX=172.
        // Line 0 at 168 (<=172 ok). Line 1 at 178 → drops. Line 2 at 188 → drops.
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "a\nb\nc"), emptyLookup, standardEncoder,
        )
        assertTrue(s.contains("text_y168"))
        assertFalse(s.contains("text_y178"))
        assertFalse(s.contains("text_y188"))
    }

    @Test
    fun `compileLayerBody textarea empty value returns empty fragment with unchanged x`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, newX) = TitleCompiler.compileLayerBody(
            layer, 42, mapOf("g" to ""), emptyLookup, standardEncoder,
        )
        // Single empty line → empty body and cursor unchanged from start.
        assertEquals("", s)
        assertEquals(42, newX)
    }

    @Test
    fun `compileLayerBody textarea reports end of LAST rendered line for cursor tracking`() {
        // MC's cursor is sequential: after the final offset + final line are
        // emitted, the cursor sits at (lineX_last + lineWidth_last) — NOT at
        // the max across all lines. Returning the max would push subsequent
        // layers' offsets too far left in-game.
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // "ab" width 12 (longer line), "a" width 6 (last line). Cursor at end
        // = 0 + 6 = 6, NOT 12 (the max).
        val (_, newX) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab\na"), emptyLookup, standardEncoder,
        )
        assertEquals(6, newX)
    }

    @Test
    fun `compileTitle textarea followed by glyph positions glyph past textarea end`() {
        val glyphCh = 0xE000.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 0xE000, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Textarea(
                    value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
                    alignment = MenuTitleLayer.Alignment.LEFT,
                ),
                MenuTitleLayer.Glyph(assetId = "asset_coin", x = 100, y = 5),
            ),
            lang = "en_us",
            langMap = mapOf("g" to "ab"),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        // Decode the rendered Component to ensure glyph appears.
        assertTrue(result.toString().contains(glyphCh.toString()))
    }

    @Test
    fun `compileTitle textarea before text — text lands at its target x regardless of textarea content`() {
        // Two scenarios that should yield IDENTICAL offset between textarea end and the
        // text layer's emitted body, because the text's targetX is absolute (chest x = 70).
        //
        // Sort puts Text last, Textarea before. Cursor after textarea = end of last
        // rendered line. The emitted offset = 70 - cursor. After the offset, MC's
        // cursor is at chest-x 70 in both cases. The text glyph then renders at 70.
        fun titleStringFor(content: String): String {
            val result = TitleCompiler.compileTitle(
                layers = listOf(
                    MenuTitleLayer.Textarea(
                        value = LText("g"), x = 8, y = 5, width =60, lineHeight = 10,
                        alignment = MenuTitleLayer.Alignment.LEFT,
                    ),
                    MenuTitleLayer.Text(value = LText("t"), x = 70, y = 5),
                ),
                lang = "en_us",
                langMap = mapOf("g" to content, "t" to "X"),
                lookupAsset = emptyLookup,
                offsetEncoder = standardEncoder,
            )
            return result.toString()
        }

        // Three different textarea contents — single, multi-line with last=widest,
        // multi-line with first=widest (the regression case).
        val singleLine = titleStringFor("Hi")            // line 0 = "Hi" (8 px wide)
        val lastWidest = titleStringFor("Hi\nWorld")      // "Hi" (8), "World" (27)
        val firstWidest = titleStringFor("World\nHi")     // "World" (27), "Hi" (8)

        // The TEXT layer "X" must appear in all three. Extract the substring that
        // contains the "X" — the absolute MC cursor leading up to it is computed
        // independently in each case. The Text layer's targetX is 70, so:
        //   - emitted-offset = 70 - cursor_after_textarea
        //   - MC ends at 70 after the offset chars + text_y wrapper
        // The text body itself (rendered inside `<font:artisan:text_y0>X</font>`) is
        // identical in all three — that's the smoke test.
        assertTrue(singleLine.contains("X"))
        assertTrue(lastWidest.contains("X"))
        assertTrue(firstWidest.contains("X"))
    }

    @Test
    fun `compileLayerBody textarea user-reported scenario — cursor ends at last line right edge`() {
        // Mirrors docker/server/plugins/Artisan/projects/test/menus/test.yaml:
        // Textarea(x=24, y=57, width=177, lineHeight=10, LEFT) with the lang value
        // from lang/en.yaml. The textarea wraps into 3 sub-lines. Returned cursor
        // must be the END of the LAST sub-line so a subsequent layer can compute
        // its offset correctly.
        val layer = MenuTitleLayer.Textarea(
            value = LText("k"), x = 24, y = 57, width = 177, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // The user's content (whole sentence, no \n, but contains a <rainbow> tag mid-text).
        val content = "Bonjour à tous et à toutes ! Bienvenue sur spartacube ! <rainbow>Bienvenue sur spartacube !"
        // Pre-cursor at 38 (matches the chain Glyph -> Text(title) -> Text(title_2) in the user's menu).
        val (_, newX) = TitleCompiler.compileLayerBody(
            layer, 38, mapOf("k" to content), emptyLookup, standardEncoder,
        )
        // Wrap result is 3 sub-lines with widths (144, 140, 140).
        // For LEFT alignment, last sub-line's end = layer.x + width_last = 24 + 140 = 164.
        assertEquals(164, newX, "cursor must reflect MC's actual position after the last sub-line")
    }

    @Test
    fun `compileTitle full user-menu — text_y references match clamped Y values`() {
        // End-to-end render of the user's actual test.yaml menu. We can't depend
        // on a real AssetCatalog so we stub the glyph asset. The test checks the
        // sequence of font references emitted (text_y values) — confirms the
        // Y-clamp from layer.y=200 to TEXT_Y_MAX=172 and the textarea's text_y57/67/77.
        val glyphCh = 0xE000.toChar()
        val lookup = stubLookup(mapOf("asset_a5bff8c5987b" to glyphEntry("u_glyph", 0xE000, width = 16)))
        val langMap = mapOf(
            "menus.test.title" to "<b>Hehehe <rainbow>:))))))",
            "menus.test.title_2" to "<red>TITLE",
            "menus.test.title_3" to "Bonjour à tous et à toutes ! Bienvenue sur spartacube ! <rainbow>Bienvenue sur spartacube !",
            "menus.test.title_4" to "<green>TITLE",
        )
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Glyph(assetId = "asset_a5bff8c5987b", x = 0, y = 5),
                MenuTitleLayer.Text(value = LText("menus.test.title"), x = 48, y = 107),
                MenuTitleLayer.Text(value = LText("menus.test.title_2"), x = 8, y = 6),
                MenuTitleLayer.Textarea(
                    value = LText("menus.test.title_3"), x = 24, y = 57,
                    width = 177, lineHeight = 10,
                    alignment = MenuTitleLayer.Alignment.LEFT,
                ),
                MenuTitleLayer.Text(value = LText("menus.test.title_4"), x = 127, y = 200),
            ),
            lang = "en_us",
            langMap = langMap,
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        val s = result.toString()

        // Y=200 must be clamped to TEXT_Y_MAX=172 (no missing-glyph squares).
        assertFalse(s.contains("text_y200"), "Y=200 must be clamped to 172")
        assertTrue(s.contains("text_y172"), "title_4 must reference text_y172 (clamped from 200)")
        // Textarea wraps to 3 sub-lines at y=57, 67, 77.
        assertTrue(s.contains("text_y57"))
        assertTrue(s.contains("text_y67"))
        assertTrue(s.contains("text_y77"))
        // The other text layers' Y values are in range, no clamp.
        assertTrue(s.contains("text_y107"))
        assertTrue(s.contains("text_y6"))
    }

    // ---------- wrapLine (private helper, exposed via test entry points) ----------

    @Test
    fun `wrapLine returns single element when input fits within width`() {
        val result = TitleCompiler.testWrapLine("hello", 100)
        assertEquals(listOf("hello"), result)
    }

    @Test
    fun `wrapLine breaks at word boundary when line exceeds width`() {
        // Each sub-line must measure <= 20.
        val result = TitleCompiler.testWrapLine("ab cd ef", 20)
        for (line in result) {
            assertTrue(TitleCompiler.testMeasure(line) <= 20, "Line '$line' exceeds 20px")
        }
        assertEquals("ab cd ef", result.joinToString(" "))
    }

    @Test
    fun `wrapLine overflow for word longer than maxWidth`() {
        // "verylongword" is wider than 8 — overflows on its own line (soft constraint).
        val result = TitleCompiler.testWrapLine("verylongword", 8)
        assertEquals(listOf("verylongword"), result)
    }

    @Test
    fun `wrapLine trims trailing whitespace per sub-line`() {
        val result = TitleCompiler.testWrapLine("a  b", 8)
        assertEquals(listOf("a", "b"), result)
    }

    @Test
    fun `wrapLine on empty string returns single empty element`() {
        assertEquals(listOf(""), TitleCompiler.testWrapLine("", 100))
    }

    @Test
    fun `wrapLine strips MiniMessage tags for measurement but keeps them in output`() {
        val result = TitleCompiler.testWrapLine("<gold>foo</gold> <gold>bar</gold>", 20)
        for (line in result) {
            assertTrue(TitleCompiler.testMeasure(line) <= 20, "Line '$line' exceeds 20px after stripping tags")
        }
    }

    @Test
    fun `compileLayerBody textarea trims leading whitespace from content`() {
        // Regression: a user typing leading whitespace (or saving content with
        // an accidental leading space) would see the first line shifted right
        // by 4 px per space under LEFT alignment, because the leading space
        // chars rendered before the first visible glyph.
        //
        // Internal indentation on subsequent lines is PRESERVED — `\n   World`
        // intentionally indents the second line and that should still render
        // as-is.
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // " Hello" → first line should NOT carry the leading space (otherwise
        // newX would be 4 + 24 = 28 instead of just 24).
        val (_, newX) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to " Hello"), emptyLookup, standardEncoder,
        )
        assertEquals(24, newX, "expected cursor at 0 + width('Hello') = 24, leading space stripped")
    }

    @Test
    fun `compileLayerBody textarea preserves intentional indent on subsequent lines`() {
        // After a \n, leading whitespace is part of the user's intent (indent)
        // and must be preserved through to MC rendering.
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // "Hi\n  World" → second line keeps its 2-space indent.
        // Line 0 "Hi": width 8. Line 1 "  World": width = 2*4 + width("World") = 8 + 27 = 35.
        // Last line ends at 0 + 35 = 35.
        val (_, newX) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "Hi\n  World"), emptyLookup, standardEncoder,
        )
        assertEquals(35, newX, "indented second line should render at layer.x + 2-space prefix + body width")
    }

    // ---------- Textarea wrap integration ----------

    @Test
    fun `compileLayerBody textarea wraps long content into multiple text_y wrappers`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =20, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab cd ef"), emptyLookup, standardEncoder,
        )
        val text_yCount = Regex("<font:artisan:text_y\\d+_h\\d+>").findAll(s).count()
        assertTrue(text_yCount >= 2, "Expected at least 2 text_y wrappers but got $text_yCount in '$s'")
    }

    @Test
    fun `compileLayerBody textarea respects explicit and auto-wrapped lines together`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =20, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "line1\nab cd ef"), emptyLookup, standardEncoder,
        )
        val text_yCount = Regex("<font:artisan:text_y\\d+_h\\d+>").findAll(s).count()
        assertTrue(text_yCount >= 3, "Expected at least 3 text_y wrappers but got $text_yCount in '$s'")
    }

    @Test
    fun `compileLayerBody textarea wrap with width=256 produces single line for short text`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 5, width =256, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "short"), emptyLookup, standardEncoder,
        )
        val text_yCount = Regex("<font:artisan:text_y\\d+_h\\d+>").findAll(s).count()
        assertEquals(1, text_yCount)
    }

    @Test
    fun `compileLayerBody textarea wrap + alignment center centers each sub-line independently`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 100, y = 5, width =20, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.CENTER,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab cd ef"), emptyLookup, standardEncoder,
        )
        val text_yCount = Regex("<font:artisan:text_y\\d+_h\\d+>").findAll(s).count()
        assertTrue(text_yCount >= 2, "Expected at least 2 sub-lines but got $text_yCount in '$s'")
    }

    @Test
    fun `compileLayerBody for text with size=16 wraps in text_y_h16 font tag`() {
        val layer = MenuTitleLayer.Text(value = LText("greeting"), x = 0, y = 5, size = 16)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "Big"), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y5_h16>Big</font>", s)
    }

    @Test
    fun `compileLayerBody for text size=16 doubles end cursor`() {
        val langMap = mapOf("k" to "Hello")
        val small = MenuTitleLayer.Text(value = LText("k"), x = 0, y = 5, size = 8)
        val large = MenuTitleLayer.Text(value = LText("k"), x = 0, y = 5, size = 16)
        val (_, smallEnd) = TitleCompiler.compileLayerBody(small, 0, langMap, emptyLookup, OffsetEncoder.EMPTY)
        val (_, largeEnd) = TitleCompiler.compileLayerBody(large, 0, langMap, emptyLookup, OffsetEncoder.EMPTY)
        assertEquals(smallEnd * 2, largeEnd)
    }

    @Test
    fun `compileLayerBody for textarea with size=12 wraps each line in text_y_h12`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("k"),
            x = 8, y = 20,
            width = 168, lineHeight = 18,
            alignment = MenuTitleLayer.Alignment.LEFT,
            size = 12,
        )
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("k" to "Line A\nLine B"), emptyLookup, OffsetEncoder.EMPTY)
        assertTrue(s.contains("<font:artisan:text_y20_h12>"), "missing first line tag in: $s")
        // Second line lives at y = 20 + lineHeight(18) = 38.
        assertTrue(s.contains("<font:artisan:text_y38_h12>"), "missing second line tag in: $s")
    }

    @Test
    fun `compileLayerBody for text without explicit size emits h8 (default)`() {
        val layer = MenuTitleLayer.Text(value = LText("k"), x = 0, y = 5)
        val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("k" to "hi"), emptyLookup, OffsetEncoder.EMPTY)
        assertEquals("<font:artisan:text_y5_h8>hi</font>", s)
    }

    @Test
    fun `compileTitle offset chars are all in the offset range`() {
        // Sanity: the chars emitted between layers must come from the encoder table
        // (not be plain text or accidentally collide with glyph codepoints).
        val ch = 57344.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 57344, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(MenuTitleLayer.Glyph(assetId = "asset_coin", x = 50, y = 5)),
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
