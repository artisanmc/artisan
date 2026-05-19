package gg.interfaze.plugin.render

import gg.interfaze.plugin.model.LText
import gg.interfaze.plugin.model.MenuTitleLayer
import gg.interfaze.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.ShadowColor
import net.kyori.adventure.text.minimessage.MiniMessage

/**
 * Compiles a list of [MenuTitleLayer]s into an Adventure [Component] suitable for
 * use as a `GuiInventory` title.
 *
 * Positioning model (since the "spaces font" sub-project):
 *
 *  - The compiler wraps the entire title in `<font:interfaze:default>...</font>`.
 *    That font includes a `reference` to `minecraft:default` (so plain text falls
 *    back to vanilla), the bitmap providers for project glyphs, and a `space`
 *    provider mapping a set of codepoints (U+F800..U+F811) to positive/negative
 *    pixel advances (powers of two, ±1..±256).
 *  - Between layers the compiler emits a sequence of "space" chars produced by
 *    [OffsetEncoder] that advances the cursor from the previous layer's end to
 *    the next layer's `x`. After the body of a layer it estimates the body's
 *    rendered width and updates the running cursor.
 *
 * Width estimation is best-effort:
 *  - Image (background/glyph): [AssetEntry.width]; falls back to 16 px when 0.
 *  - Text: heuristic `length * 6` (MC default font is mostly 6 px wide per char;
 *    real widths range 1–9 — accuracy is not pixel-perfect for v1).
 *  - External glyph: 8 px placeholder.
 *
 * Pure function: no side effects, no global state, no I/O. The [lookupAsset]
 * and [offsetEncoder] parameters are the only injected dependencies — pass
 * `assetCatalog::lookup` and `assetCatalog.offsetEncoder()` at the call site
 * to bind them to a live catalog, or stubs in tests.
 */
object TitleCompiler {

    /** Default font wrapper for the title. */
    private const val DEFAULT_FONT = "interfaze:default"

    /**
     * Standard MC chest GUI title draw X offset (`titleLabelX = 8`). The title
     * Component's cursor 0 corresponds to chest-x 8, so we start `currentX` at
     * this value to convert from chest-left-relative layer coordinates (what the
     * editor stores) to plugin cursor coordinates.
     *
     * Exposed `internal` so unit tests can reference the constant directly.
     */
    internal const val TITLE_LABEL_X = 8

    /** Fallback width for an image asset whose `width` is unknown (legacy v1 pack). */
    private const val FALLBACK_IMAGE_WIDTH = 16

    /** Width estimate for an external-provider glyph (since we can't introspect it). */
    private const val EXTERNAL_GLYPH_WIDTH = 8

    /**
     * Range of Y values for which the backend generates `text_y{Y}.json` font
     * files. Kept in sync with `backend/src/lib/resourcePackBuilder.ts`.
     *
     * Lines whose Y lands outside this range would resolve to a missing font
     * namespace and render as missing-glyph squares in-game. Both the Text and
     * Textarea branches clamp/drop content that would otherwise reference an
     * out-of-range font.
     */
    internal const val TEXT_Y_MIN = -32
    internal const val TEXT_Y_MAX = 172

    /**
     * Best-effort pixel width of a single MiniMessage-bearing line. Strips
     * tags via the same regex used by [estimateBodyWidth], sums per-char
     * advances from [charAdvance], and adds the MC bold-shift bump via
     * [countBoldChars]. Used by the [MenuTitleLayer.Textarea] branch to
     * compute per-line widths for alignment math.
     */
    private fun measureLineWidth(text: String): Int {
        val anyTagPattern = Regex("<[^>]+>")
        val visible = anyTagPattern.replace(text, "")
        return visible.sumOf { charAdvance(it) } + countBoldChars(text)
    }

    /**
     * Splits a single line into N sub-lines, each fitting within [maxWidth] px.
     * Wraps at whitespace boundaries. A single word wider than [maxWidth]
     * overflows on its own line (soft constraint — see textarea-auto-wrap spec).
     *
     * MiniMessage tags are inline; [measureLineWidth] strips them so they don't
     * count toward the measured width. Tag spans crossing sub-line boundaries
     * are tolerated by MC's MiniMessage stack.
     */
    private fun wrapLine(line: String, maxWidth: Int): List<String> {
        if (line.isEmpty()) return listOf("")
        // Tokens alternate between word-runs and whitespace-runs; preserved
        // separately so we can trim them at sub-line edges without losing
        // internal spacing.
        val tokens = line.split(Regex("(?<=\\s)|(?=\\s)")).filter { it.isNotEmpty() }
        val out = mutableListOf<String>()
        val current = StringBuilder()
        var currentWidth = 0
        for (token in tokens) {
            val tokenWidth = measureLineWidth(token)
            if (currentWidth + tokenWidth <= maxWidth) {
                current.append(token)
                currentWidth += tokenWidth
                continue
            }
            // Doesn't fit. If current line is empty (or only whitespace), place
            // this token alone — overflow if longer than maxWidth (soft).
            if (current.isBlank()) {
                out.add(token.trimEnd())
                current.clear()
                currentWidth = 0
                continue
            }
            // Flush current line, start fresh with this token.
            out.add(current.toString().trimEnd())
            current.clear()
            val trimmed = token.trimStart()
            if (trimmed.isNotEmpty()) {
                current.append(trimmed)
                currentWidth = measureLineWidth(trimmed)
            } else {
                currentWidth = 0
            }
        }
        if (current.isNotEmpty()) {
            val flushed = current.toString().trimEnd()
            if (flushed.isNotEmpty()) out.add(flushed)
        }
        return out.ifEmpty { listOf("") }
    }

    /** Test-only: exposes the private wrapLine for unit tests. */
    internal fun testWrapLine(line: String, maxWidth: Int): List<String> = wrapLine(line, maxWidth)

    /** Test-only: exposes measureLineWidth for unit tests asserting on wrap output. */
    internal fun testMeasure(line: String): Int = measureLineWidth(line)

    /**
     * Per-character advance (px) for the MC 1.21 default ASCII bitmap font
     * (minecraft:font/ascii.png, 8×8 glyph cells, height=8, scale=1).
     *
     * Formula: advance = (rightmost_non_transparent_column + 1) + 1 spacing.
     * Space uses the `space` provider in text_y{Y}.json → 4 px (same as vanilla).
     * Non-ASCII characters fall back to 6 (most extended Latin chars are 5-wide).
     * Scanned from the actual 1.21.4 ascii.png via alpha-channel rightmost column.
     */
    private fun charAdvance(ch: Char): Int = when (ch) {
        ' '  -> 4
        '!'  -> 2; '"'  -> 4; '#'  -> 6; '$'  -> 6; '%'  -> 6; '&'  -> 6
        '\'' -> 2; '('  -> 4; ')'  -> 4; '*'  -> 4; '+'  -> 6; ','  -> 2
        '-'  -> 6; '.'  -> 2; '/'  -> 6
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9' -> 6
        ':'  -> 2; ';'  -> 2; '<'  -> 5; '='  -> 6; '>'  -> 5; '?'  -> 6
        '@'  -> 7
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H' -> 6
        'I'  -> 4
        'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
        'U', 'V', 'W', 'X', 'Y', 'Z' -> 6
        '['  -> 4; '\\'  -> 6; ']'  -> 4; '^'  -> 6; '_'  -> 6; '`'  -> 3
        'a', 'b', 'c', 'd', 'e' -> 6
        'f'  -> 5
        'g', 'h' -> 6
        'i'  -> 2
        'j'  -> 6
        'k'  -> 5
        'l'  -> 3
        'm', 'n', 'o', 'p', 'q', 'r', 's' -> 6
        't'  -> 4
        'u', 'v', 'w', 'x', 'y', 'z' -> 6
        '{'  -> 4; '|'  -> 2; '}'  -> 4; '~'  -> 7
        else -> 6
    }

    /**
     * Compiles [layers] into a [Component]. Returns [Component.empty] when
     * [layers] is empty.
     *
     * The returned component has its shadow suppressed at the root — vanilla
     * MC draws a 1-px drop shadow under every glyph in chest titles, which
     * darkens image glyphs sampled from the font texture. Suppressing it at
     * the root cascades to every child segment. Trade-off: text layers also
     * lose their shadow. Acceptable for v3; per-layer shadow control can be
     * reintroduced later if needed.
     */
    fun compileTitle(
        layers: List<MenuTitleLayer>,
        lang: String,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
        offsetEncoder: OffsetEncoder = OffsetEncoder.EMPTY,
    ): Component {
        if (layers.isEmpty()) return Component.empty()
        // Plain (vanilla) mode: no resource pack, no font wrapper, no shadow suppression.
        // Emit raw MiniMessage and let MC render with its default font and shadow.
        if (layers.all { it is MenuTitleLayer.Plain }) {
            val sb = StringBuilder()
            for (layer in layers) {
                layer as MenuTitleLayer.Plain
                val text = resolveLText(layer.value, langMap)
                sb.append(layer.color?.let { "<color:$it>$text</color>" } ?: text)
            }
            return MiniMessage.miniMessage().deserialize(sb.toString())
        }
        // Stable-sort so non-text layers come first. Image/glyph widths are known
        // from the asset catalog, so cursor tracking is exact for them. Text-bearing
        // widths are estimated (charAdvance-based), so placing them last means
        // estimation error never propagates to subsequent glyph/background positions.
        // Both `Text` and `Textarea` are text-bearing — they share this property.
        // Within each group the original array order (= visual stacking from bottom
        // to top) is preserved.
        val sorted = layers.sortedWith(compareBy {
            when (it) {
                is MenuTitleLayer.Text, is MenuTitleLayer.Textarea -> 1
                else -> 0
            }
        })
        val sb = StringBuilder()
        sb.append("<font:$DEFAULT_FONT>")
        // Start the cursor at TITLE_LABEL_X so layer.x values (chest-left-relative,
        // matching the editor's coordinate system) map correctly to the title string's
        // cursor position (which MC draws at titleLabelX from the chest left edge).
        var currentX = TITLE_LABEL_X
        for (layer in sorted) {
            val isTextarea = layer is MenuTitleLayer.Textarea
            val targetX = layerX(layer)
            // For non-textarea: emit outer offset to position cursor at targetX,
            // then pass targetX as startX (the layer body draws from there).
            // For textarea: skip the outer offset; the branch emits its own
            // per-line offsets from `currentX`.
            val startX = if (isTextarea) {
                currentX
            } else {
                if (targetX != currentX) sb.append(offsetEncoder.encode(targetX - currentX))
                targetX
            }
            val (frag, newX) = compileLayerBody(layer, startX, langMap, lookupAsset, offsetEncoder)
            sb.append(frag)
            currentX = newX
        }
        sb.append("</font>")
        return MiniMessage.miniMessage()
            .deserialize(sb.toString())
            .shadowColor(ShadowColor.none())
    }

    /**
     * Compiles a single [layer] to its MiniMessage string fragment WITHOUT
     * the outer font wrapper or offset chars. Internal so unit tests can
     * assert on the produced string directly.
     *
     * Returns a [Pair] of (fragment, newCursorX). [startX] is the cursor position
     * at the moment this layer begins drawing; the returned cursor is
     * `startX + estimateBodyWidth(...)` for all current kinds. The Textarea branch
     * (Task 4) will own its own per-line offset emission and therefore needs both
     * the incoming cursor and the [offsetEncoder].
     *
     * Returned MiniMessage assumes it will be rendered inside an outer
     * `<font:interfaze:default>` (set by [compileTitle]).
     */
    internal fun compileLayerBody(
        layer: MenuTitleLayer,
        startX: Int,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
        offsetEncoder: OffsetEncoder,
    ): Pair<String, Int> {
        val body: String = when (layer) {
            is MenuTitleLayer.Background -> {
                val entry = lookupAsset(layer.assetId) ?: return Pair("", startX)
                val ch = entry.codepointChar ?: return Pair("", startX)
                // Explicit white: chest titles render with MC's dark-gray 0x404040 by default.
                // Without a color override the glyph pixels get tinted dark, making the image
                // look wrong. White (×1.0 multiply) preserves the original PNG colors.
                "<white>$ch</white>"
            }
            is MenuTitleLayer.Glyph -> {
                val entry = lookupAsset(layer.assetId) ?: return Pair("", startX)
                val ch = entry.codepointChar ?: return Pair("", startX)
                "<white>$ch</white>"
            }
            is MenuTitleLayer.Text -> {
                val text = resolveLText(layer.value, langMap)
                val colored = layer.color?.let { "<color:$it>$text</color>" } ?: text
                // Custom font asset: use its namespace directly (user-imported font).
                if (layer.fontAssetId != null) {
                    val ns = lookupAsset(layer.fontAssetId)?.takeIf { it.type == "font" }?.namespace
                    if (ns != null) return Pair(
                        "<font:$ns>$colored</font>",
                        startX + estimateBodyWidth(layer, langMap, lookupAsset),
                    )
                }
                // Y-specific font: resource pack includes text_y{Y}.json for Y in
                // [TEXT_Y_MIN, TEXT_Y_MAX], each using minecraft:font/ascii.png with
                // ascent = 13 - Y so the glyph top lands at the desired chest-relative
                // Y pixel. Clamp out-of-range Y to the nearest valid value — without
                // this, MC would resolve a missing font and render every char as a
                // missing-glyph square in the title.
                val clampedY = layer.y.coerceIn(TEXT_Y_MIN, TEXT_Y_MAX)
                "<font:interfaze:text_y${clampedY}>$colored</font>"
            }
            is MenuTitleLayer.Plain -> {
                val text = resolveLText(layer.value, langMap)
                layer.color?.let { "<color:$it>$text</color>" } ?: text
            }
            is MenuTitleLayer.ExternalGlyph -> {
                // ExternalGlyphsCatalog doesn't exist yet (Sub-project 5).
                // Fall back to a visible placeholder so the menu still opens.
                "□"
            }
            is MenuTitleLayer.Textarea -> {
                val raw = resolveLText(layer.value, langMap)
                // Trim leading whitespace from the ENTIRE content (drops accidental
                // leading spaces / newlines at the start of the textarea). Internal
                // indentation after a hard `\n` is preserved — the user's intent on
                // subsequent lines is kept (e.g. `"Title\n  Indented"` stays indented).
                val text = raw.trimStart()
                val hardLines = text.split("\n")
                val lines = hardLines.flatMap { wrapLine(it, layer.width) }
                val sb2 = StringBuilder()
                // localX = MC's cursor position, advanced sequentially: each
                // offset emission and each rendered line moves the cursor by
                // the corresponding delta. The cursor at the END of the
                // textarea sits at `localX` after the last iteration — NOT at
                // the max across all lines. Subsequent layers anchor their
                // own offsets from this value, so returning anything else
                // (e.g. max-end-of-line) would shift them left/right in-game.
                var localX = startX
                for ((i, line) in lines.withIndex()) {
                    val lineY = layer.y + i * layer.lineHeight
                    // text_y{Y}.json files exist for Y in [TEXT_Y_MIN, TEXT_Y_MAX]
                    // (kept in sync with backend/src/lib/resourcePackBuilder.ts).
                    // Lines outside this range would render as missing-glyph
                    // squares in-game, so drop them rather than emit broken refs.
                    if (lineY < TEXT_Y_MIN || lineY > TEXT_Y_MAX) break
                    if (line.isEmpty()) continue // skip empty lines (no advance, no render)
                    val lineWidth = measureLineWidth(line)
                    val lineX = when (layer.alignment) {
                        MenuTitleLayer.Alignment.LEFT -> layer.x
                        MenuTitleLayer.Alignment.CENTER -> layer.x - lineWidth / 2
                        MenuTitleLayer.Alignment.RIGHT -> layer.x - lineWidth
                    }
                    if (lineX != localX) sb2.append(offsetEncoder.encode(lineX - localX))
                    sb2.append("<font:interfaze:text_y${lineY}>")
                    sb2.append(line)
                    sb2.append("</font>")
                    localX = lineX + lineWidth
                }
                return Pair(sb2.toString(), localX)
            }
        }
        return Pair(body, startX + estimateBodyWidth(layer, langMap, lookupAsset))
    }

    /**
     * Pixel `x` of the layer's origin. [MenuTitleLayer.Background] has no `x`
     * field — it anchors at the title origin (0).
     */
    internal fun layerX(layer: MenuTitleLayer): Int = when (layer) {
        is MenuTitleLayer.Background -> 0
        is MenuTitleLayer.Glyph -> layer.x
        is MenuTitleLayer.Text -> layer.x
        is MenuTitleLayer.Plain -> 0
        is MenuTitleLayer.ExternalGlyph -> layer.x
        is MenuTitleLayer.Textarea -> layer.x
    }

    /**
     * Best-effort pixel width of [layer]'s rendered body. Used to advance the
     * cursor past the layer so the next offset is measured relative to the
     * layer's end. See KDoc on [TitleCompiler] for accuracy notes.
     */
    internal fun estimateBodyWidth(
        layer: MenuTitleLayer,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
    ): Int = when (layer) {
        is MenuTitleLayer.Background -> {
            // MC bitmap font advance = measured_width + 1 (BitmapFont.Glyph.getAdvance()).
            val w = lookupAsset(layer.assetId)?.width ?: 0
            (if (w > 0) w else FALLBACK_IMAGE_WIDTH) + 1
        }
        is MenuTitleLayer.Glyph -> {
            val w = lookupAsset(layer.assetId)?.width ?: 0
            (if (w > 0) w else FALLBACK_IMAGE_WIDTH) + 1
        }
        is MenuTitleLayer.Text -> {
            val text = resolveLText(layer.value, langMap)
            measureLineWidth(text)
        }
        is MenuTitleLayer.Plain -> {
            val text = resolveLText(layer.value, langMap)
            measureLineWidth(text)
        }
        is MenuTitleLayer.ExternalGlyph -> EXTERNAL_GLYPH_WIDTH
        is MenuTitleLayer.Textarea -> {
            val text = resolveLText(layer.value, langMap)
            val hardLines = text.split("\n")
            val lines = hardLines.flatMap { wrapLine(it, layer.width) }
            lines.maxOfOrNull { measureLineWidth(it) } ?: 0
        }
    }

    /**
     * Counts visible characters (stripped of tags) inside bold spans.
     * Handles both closed (`<bold>…</bold>`, `<b>…</b>`) and unclosed (`<bold>…` to
     * end-of-string) spans, since MiniMessage allows implicit close at string end.
     * Used to add 1px per bold char to the advance estimate (MC bold rendering shifts
     * each glyph 1px right, increasing its effective advance by 1).
     */
    private fun countBoldChars(text: String): Int {
        val boldTagPattern = Regex("</?(?:bold|b)>")
        val anyTagPattern = Regex("<[^>]+>")
        var inBold = false
        var count = 0
        var lastEnd = 0
        for (match in boldTagPattern.findAll(text)) {
            if (inBold) {
                val segment = text.substring(lastEnd, match.range.first)
                count += anyTagPattern.replace(segment, "").length
            }
            inBold = !match.value.startsWith("</")
            lastEnd = match.range.last + 1
        }
        // Handle unclosed bold tag (bold until end of string).
        if (inBold) {
            count += anyTagPattern.replace(text.substring(lastEnd), "").length
        }
        return count
    }

    private fun resolveLText(value: LText, langMap: Map<String, String>): String =
        langMap[value.key] ?: value.key
}
