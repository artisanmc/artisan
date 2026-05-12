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
 * Each layer is converted to a MiniMessage string fragment (with optional `<color>`
 * and `<font>` wrappers), the fragments are concatenated, and the result is rendered
 * via [MiniMessage.deserialize] in a single pass.
 *
 * NOTE: Per-layer `x` offsets are intentionally dropped — Adventure MiniMessage
 * does not natively support `<offset:Xpx>` tags, so emitting them resulted in literal
 * text leaking into titles. Proper positioning requires a "negative space font" in
 * the resource pack plus a custom `TagResolver` that maps `<offset>` to space-char
 * sequences. Filed as a future SP. For now, layers render in array order without
 * explicit horizontal positioning.
 *
 * Pure function: no side effects, no global state, no I/O. The [lookupAsset]
 * parameter is the only injected dependency — pass `assetCatalog::lookup` at the
 * call site to bind it to a live catalog, or a stub `Map<String, AssetEntry>::get`
 * in tests.
 */
object TitleCompiler {

    /**
     * Compiles [layers] into a [Component].
     *
     * Returns [Component.empty] when [layers] is empty.
     */
    fun compileTitle(
        layers: List<MenuTitleLayer>,
        lang: String,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
    ): Component {
        if (layers.isEmpty()) return Component.empty()
        val sb = StringBuilder()
        for (layer in layers) {
            sb.append(compileLayer(layer, langMap, lookupAsset))
        }
        // Drop the default MC text shadow on the entire title. Vanilla draws a 1px
        // dark drop-shadow under every glyph in chest titles; this is fine for letters
        // but darkens image glyphs sampled from the font texture, making custom
        // backgrounds/icons look "obscured". Setting shadowColor to fully transparent
        // (ARGB 0x00000000) at the root suppresses it for every child segment.
        // Trade-off: text layers also lose their shadow. Acceptable for v3; per-layer
        // shadow control can be reintroduced later if needed.
        return MiniMessage.miniMessage()
            .deserialize(sb.toString())
            .shadowColor(ShadowColor.none())
    }

    /**
     * Compiles a single [layer] to its MiniMessage string fragment.
     *
     * Internal so unit tests can assert on the raw produced string directly
     * (cleaner than introspecting Adventure Components).
     */
    internal fun compileLayer(
        layer: MenuTitleLayer,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
    ): String = when (layer) {
        is MenuTitleLayer.Background -> {
            val entry = lookupAsset(layer.assetId) ?: return ""
            val ch = entry.codepointChar ?: return ""
            // No offset for backgrounds — they anchor at the title baseline.
            "<font:interfaze:default>$ch</font>"
        }
        is MenuTitleLayer.Glyph -> {
            val entry = lookupAsset(layer.assetId) ?: return ""
            val ch = entry.codepointChar ?: return ""
            wrapOffset(layer.x, "<font:interfaze:default>$ch</font>")
        }
        is MenuTitleLayer.Text -> {
            val text = resolveLText(layer.value, langMap)
            val colored = layer.color?.let { "<color:$it>$text</color>" } ?: text
            val fonted = layer.fontAssetId?.let { id ->
                val ns = lookupAsset(id)?.takeIf { it.type == "font" }?.namespace
                if (ns != null) "<font:$ns>$colored</font>" else colored
            } ?: colored
            wrapOffset(layer.x, fonted)
        }
        is MenuTitleLayer.ExternalGlyph -> {
            // ExternalGlyphsCatalog doesn't exist yet (Sub-project 5).
            // Fall back to a visible placeholder so the menu still opens.
            wrapOffset(layer.x, "□")
        }
    }

    /**
     * Offset emission is dropped pending a real space-font implementation
     * (see KDoc on [TitleCompiler]). This function is kept as a single
     * choke-point so the future fix can re-introduce wrapping in one place.
     */
    @Suppress("UNUSED_PARAMETER")
    private fun wrapOffset(xPixels: Int, body: String): String = body

    private fun resolveLText(value: LText, langMap: Map<String, String>): String =
        langMap[value.key] ?: value.key
}
