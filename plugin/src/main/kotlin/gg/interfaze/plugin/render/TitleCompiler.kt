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

    /** Fallback width for an image asset whose `width` is unknown (legacy v1 pack). */
    private const val FALLBACK_IMAGE_WIDTH = 16

    /** Approximate pixel width of one MC default-font character. */
    private const val APPROX_CHAR_WIDTH = 6

    /** Width estimate for an external-provider glyph (since we can't introspect it). */
    private const val EXTERNAL_GLYPH_WIDTH = 8

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
        val sb = StringBuilder()
        sb.append("<font:$DEFAULT_FONT>")
        var currentX = 0
        for (layer in layers) {
            val targetX = layerX(layer)
            if (targetX != currentX) {
                sb.append(offsetEncoder.encode(targetX - currentX))
            }
            sb.append(compileLayerBody(layer, langMap, lookupAsset))
            currentX = targetX + estimateBodyWidth(layer, langMap, lookupAsset)
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
     * Returned MiniMessage assumes it will be rendered inside an outer
     * `<font:interfaze:default>` (set by [compileTitle]).
     */
    internal fun compileLayerBody(
        layer: MenuTitleLayer,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
    ): String = when (layer) {
        is MenuTitleLayer.Background -> {
            val entry = lookupAsset(layer.assetId) ?: return ""
            val ch = entry.codepointChar ?: return ""
            "$ch"
        }
        is MenuTitleLayer.Glyph -> {
            val entry = lookupAsset(layer.assetId) ?: return ""
            val ch = entry.codepointChar ?: return ""
            "$ch"
        }
        is MenuTitleLayer.Text -> {
            val text = resolveLText(layer.value, langMap)
            val colored = layer.color?.let { "<color:$it>$text</color>" } ?: text
            layer.fontAssetId?.let { id ->
                val ns = lookupAsset(id)?.takeIf { it.type == "font" }?.namespace
                if (ns != null) "<font:$ns>$colored</font>" else colored
            } ?: colored
        }
        is MenuTitleLayer.ExternalGlyph -> {
            // ExternalGlyphsCatalog doesn't exist yet (Sub-project 5).
            // Fall back to a visible placeholder so the menu still opens.
            "□"
        }
    }

    /**
     * Pixel `x` of the layer's origin. [MenuTitleLayer.Background] has no `x`
     * field — it anchors at the title origin (0).
     */
    internal fun layerX(layer: MenuTitleLayer): Int = when (layer) {
        is MenuTitleLayer.Background -> 0
        is MenuTitleLayer.Glyph -> layer.x
        is MenuTitleLayer.Text -> layer.x
        is MenuTitleLayer.ExternalGlyph -> layer.x
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
            val w = lookupAsset(layer.assetId)?.width ?: 0
            if (w > 0) w else FALLBACK_IMAGE_WIDTH
        }
        is MenuTitleLayer.Glyph -> {
            val w = lookupAsset(layer.assetId)?.width ?: 0
            if (w > 0) w else FALLBACK_IMAGE_WIDTH
        }
        is MenuTitleLayer.Text -> {
            val text = resolveLText(layer.value, langMap)
            text.length * APPROX_CHAR_WIDTH
        }
        is MenuTitleLayer.ExternalGlyph -> EXTERNAL_GLYPH_WIDTH
    }

    private fun resolveLText(value: LText, langMap: Map<String, String>): String =
        langMap[value.key] ?: value.key
}
