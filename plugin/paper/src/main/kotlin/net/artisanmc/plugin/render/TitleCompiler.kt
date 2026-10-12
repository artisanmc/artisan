package net.artisanmc.plugin.render

import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.ShadowColor
import net.kyori.adventure.text.minimessage.MiniMessage

/**
 * Compiles a list of [MenuTitleLayer]s into an Adventure [Component] suitable for
 * use as a `GuiInventory` title.
 *
 * Positioning model (since the "spaces font" sub-project):
 *
 *  - The compiler wraps the entire title in `<font:artisan:default>...</font>`.
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
    private const val DEFAULT_FONT = "artisan:default"

    /**
     * Standard MC chest GUI title draw X offset (`titleLabelX = 8`). The title
     * Component's cursor 0 corresponds to chest-x 8, so we start `currentX` at
     * this value to convert from chest-left-relative layer coordinates (what the
     * editor stores) to plugin cursor coordinates.
     *
     * Exposed `internal` so unit tests can reference the constant directly.
     */
    internal const val TITLE_LABEL_X = 8

    /** A title glyph's top lands at chest-Y `13 - ascent`. Mirrors `GLYPH_Y_BASE` in `backend/src/lib/fontJsonBuilder.ts`. */
    internal const val GLYPH_Y_BASE = 13

    /** Fallback width for an image asset whose `width` is unknown (legacy v1 project). */
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
     * Minimum chest-Y for which the backend emits `text_y{Y}_h{H}.json`. Below
     * this, the font's ascent would exceed its height — MC 1.21+ and Nexo both
     * reject these as schema-invalid. Kept in sync with `minYForSize(h)` in
     * `backend/src/lib/fontJsonBuilder.ts`; see the test there for the formula.
     */
    internal val MIN_Y_BY_SIZE: Map<Int, Int> = mapOf(
        8 to 5,
        12 to 1,
        16 to -3,
        20 to -7,
        24 to -11,
        32 to -19,
    )

    internal fun minYForSize(size: Int): Int = MIN_Y_BY_SIZE[size] ?: TEXT_Y_MIN

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
     * Per-character advance (MC pixels) for the vanilla default font.
     * Consults [CHAR_ADVANCES] — a generated table built from the actual
     * vanilla 1.21.4 textures (ascii.png + accented.png + nonlatin_european.png)
     * in vanilla provider order, with the space provider overlay applied.
     *
     * Fallback to 1 mirrors MC's empty-cell behavior (rightmost-non-transparent
     * column = -1, plus 1 spacing). Surrogate-pair code points (e.g. emoji)
     * land on the fallback too — the table only covers the BMP.
     */
    private fun charAdvance(ch: Char): Int = CHAR_ADVANCES[ch.code] ?: 1

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
        // Post-i18n interpolation: applied to every text-bearing layer's resolved
        // string. Used by MenuRenderer to expand `{arg}` placeholders from the
        // ExecutionContext and `%papi%` placeholders via PlaceholderAPI. Default
        // is identity for callers (tests, dump-title) that don't need it.
        interpolate: (String) -> String = { it },
        /** Project default language — fallback for field-local title maps. */
        defaultLang: String = "",
    ): Component {
        if (layers.isEmpty()) return Component.empty()
        // Plain (vanilla) mode: no resource project, no font wrapper, no shadow suppression.
        // Emit raw MiniMessage and let MC render with its default font and shadow.
        if (layers.all { it is MenuTitleLayer.Plain }) {
            val sb = StringBuilder()
            for (layer in layers) {
                layer as MenuTitleLayer.Plain
                val text = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
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
                is MenuTitleLayer.Text, is MenuTitleLayer.Textarea, is MenuTitleLayer.Plain -> 1
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
            val (frag, newX) = compileLayerBody(layer, startX, langMap, lookupAsset, offsetEncoder, interpolate, lang, defaultLang)
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
     * `<font:artisan:default>` (set by [compileTitle]).
     */
    internal fun compileLayerBody(
        layer: MenuTitleLayer,
        startX: Int,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
        offsetEncoder: OffsetEncoder,
        interpolate: (String) -> String = { it },
        lang: String = "",
        defaultLang: String = "",
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
                // The default font draws the glyph at `13 - ascent`. Any other Y
                // goes through `glyph_y{Y}`, which the backend emits for each
                // (glyph, Y) its menus use — clamped like it to `ascent <= height`.
                val y = maxOf(layer.y, GLYPH_Y_BASE - entry.height)
                if (entry.namespace != null) "<font:${entry.namespace}><white>$ch</white></font>"
                else if (y == GLYPH_Y_BASE - entry.ascent) "<white>$ch</white>"
                else "<font:artisan:glyph_y$y><white>$ch</white></font>"
            }
            is MenuTitleLayer.Text -> {
                val text = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
                val colored = layer.color?.let { "<color:$it>$text</color>" } ?: text
                // Custom font asset: use its namespace directly (user-imported font).
                val fontAssetId = layer.fontAssetId
                if (fontAssetId != null) {
                    val ns = lookupAsset(fontAssetId)?.takeIf { it.type == "font" }?.namespace
                    if (ns != null) return Pair(
                        "<font:$ns>$colored</font>",
                        startX + estimateBodyWidth(layer, langMap, lookupAsset, interpolate, lang, defaultLang),
                    )
                }
                // Y-specific font: resource project includes text_y{Y}.json for Y in
                // [TEXT_Y_MIN, TEXT_Y_MAX], each using minecraft:font/ascii.png with
                // ascent = 13 - Y so the glyph top lands at the desired chest-relative
                // Y pixel. Clamp out-of-range Y to the nearest valid value — without
                // this, MC would resolve a missing font and render every char as a
                // missing-glyph square in the title.
                // Clamp UP to the per-size floor (ascent <= height schema constraint)
                // and DOWN to TEXT_Y_MAX. Anything below the floor would resolve to
                // a missing-font reference and render as missing-glyph squares.
                val clampedY = layer.y.coerceIn(minYForSize(layer.size), TEXT_Y_MAX)
                "<font:artisan:text_y${clampedY}_h${layer.size}>$colored</font>"
            }
            is MenuTitleLayer.Plain -> {
                val text = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
                layer.color?.let { "<color:$it>$text</color>" } ?: text
            }
            is MenuTitleLayer.ExternalGlyph -> {
                // ExternalGlyphsCatalog doesn't exist yet (Sub-project 5).
                // Fall back to a visible placeholder so the menu still opens.
                "□"
            }
            is MenuTitleLayer.Textarea -> {
                val raw = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
                // Trim leading whitespace from the ENTIRE content (drops accidental
                // leading spaces / newlines at the start of the textarea). Internal
                // indentation after a hard `\n` is preserved — the user's intent on
                // subsequent lines is kept (e.g. `"Title\n  Indented"` stays indented).
                val text = raw.trimStart()
                val hardLines = text.split("\n")
                // wrapLine measures in size-8 pixel units; for sized text we
                // shrink the effective wrap width so the rendered line still
                // fits in `layer.width` chest pixels.
                val effectiveWidth = (layer.width * 8) / layer.size
                val lines = hardLines.flatMap { wrapLine(it, effectiveWidth) }
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
                    // text_y{Y}_h{H}.json files exist for Y in [minYForSize(H), TEXT_Y_MAX]
                    // (kept in sync with backend/src/lib/resourcePackBuilder.ts).
                    // Lines outside this range would render as missing-glyph
                    // squares in-game, so drop them rather than emit broken refs.
                    if (lineY < minYForSize(layer.size) || lineY > TEXT_Y_MAX) break
                    if (line.isEmpty()) continue // skip empty lines (no advance, no render)
                    val lineWidth = (measureLineWidth(line) * layer.size) / 8
                    val lineX = when (layer.alignment) {
                        MenuTitleLayer.Alignment.LEFT -> layer.x
                        MenuTitleLayer.Alignment.CENTER -> layer.x - lineWidth / 2
                        MenuTitleLayer.Alignment.RIGHT -> layer.x - lineWidth
                    }
                    if (lineX != localX) sb2.append(offsetEncoder.encode(lineX - localX))
                    sb2.append("<font:artisan:text_y${lineY}_h${layer.size}>")
                    sb2.append(line)
                    sb2.append("</font>")
                    localX = lineX + lineWidth
                }
                return Pair(sb2.toString(), localX)
            }
        }
        return Pair(body, startX + estimateBodyWidth(layer, langMap, lookupAsset, interpolate, lang, defaultLang))
    }

    /**
     * Pixel `x` of the layer's origin. [MenuTitleLayer.Background] has no `x`
     * field — it anchors at the title origin (0).
     */
    internal fun layerX(layer: MenuTitleLayer): Int = when (layer) {
        is MenuTitleLayer.Background -> 0
        is MenuTitleLayer.Glyph -> layer.x
        is MenuTitleLayer.Text -> layer.x
        is MenuTitleLayer.Plain -> TITLE_LABEL_X
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
        interpolate: (String) -> String = { it },
        lang: String = "",
        defaultLang: String = "",
    ): Int = when (layer) {
        is MenuTitleLayer.Background -> {
            // MC bitmap font advance = measured_width + 1 (BitmapFont.Glyph.getAdvance()).
            val w = lookupAsset(layer.assetId)?.width ?: 0
            (if (w > 0) w else FALLBACK_IMAGE_WIDTH) + 1
        }
        is MenuTitleLayer.Glyph -> {
            val entry = lookupAsset(layer.assetId)
            val w = entry?.width ?: 0
            (if (w > 0 || entry?.namespace?.startsWith("artisan:buttons/") == true) w else FALLBACK_IMAGE_WIDTH) + 1
        }
        is MenuTitleLayer.Text -> {
            val text = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
            // Bitmap font scales advance proportionally with height: a width of
            // N px at size 8 becomes N × (size/8) at any other size.
            (measureLineWidth(text) * layer.size) / 8
        }
        is MenuTitleLayer.Plain -> {
            val text = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
            measureLineWidth(text)
        }
        is MenuTitleLayer.ExternalGlyph -> EXTERNAL_GLYPH_WIDTH
        is MenuTitleLayer.Textarea -> {
            val text = interpolate(resolveLText(layer.value, langMap, lang, defaultLang))
            val hardLines = text.split("\n")
            val effectiveWidth = (layer.width * 8) / layer.size
            val lines = hardLines.flatMap { wrapLine(it, effectiveWidth) }
            lines.maxOfOrNull { (measureLineWidth(it) * layer.size) / 8 } ?: 0
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

    /**
     * Resolve an [LText] reference against a language map. When the key isn't
     * present (referencedKeys serialization could be lagging, or the user just
     * never typed a value), we return `""` rather than echoing the raw key —
     * showing `menus.foo.title` in chat is worse than showing nothing.
     */
    // Legacy § codes are converted to MiniMessage tags at the resolution choke
    // point — the compiled title string embeds user text inside MM machinery
    // (font wrapper, offsets), where a raw § would make the final deserialize throw.
    /**
     * A ref resolves through its key and renders EMPTY when missing — never echo
     * a raw key at a player. A literal (inline mode) resolves through its
     * canonical address and falls back to the literal text itself.
     */
    private fun resolveLText(
        value: LText,
        langMap: Map<String, String>,
        lang: String = "",
        defaultLang: String = "",
    ): String {
        val localized = value.localized
        val resolved =
            if (localized != null) localized[lang] ?: localized[defaultLang] ?: localized.values.firstOrNull() ?: ""
            else if (value.literal) value.address?.let { langMap[it] } ?: value.key
            else langMap[value.key] ?: ""
        return LenientText.legacyToMini(resolved)
    }
}
