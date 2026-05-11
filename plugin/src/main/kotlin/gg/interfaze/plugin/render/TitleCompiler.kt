package gg.interfaze.plugin.render

import gg.interfaze.plugin.model.LText
import gg.interfaze.plugin.model.MenuTitleLayer
import gg.interfaze.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage

/**
 * Compiles a list of [MenuTitleLayer]s into an Adventure [Component] suitable for
 * use as a `GuiInventory` title.
 *
 * Each layer is converted to a MiniMessage string fragment (with optional `<offset>`,
 * `<color>`, and `<font>` wrappers), the fragments are concatenated, and the result
 * is rendered via [MiniMessage.deserialize] in a single pass.
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
        return MiniMessage.miniMessage().deserialize(sb.toString())
    }

    /**
     * Compiles a single [layer] to its MiniMessage string fragment.
     *
     * Internal so unit tests can assert on the raw produced string directly
     * (cleaner than introspecting Adventure Components).
     */
    @Suppress("UNUSED_PARAMETER")
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
            // fontAssetId is forward-compat — Sub-project 4 wraps in <font:interfaze:my_font>.
            wrapOffset(layer.x, colored)
        }
        is MenuTitleLayer.ExternalGlyph -> {
            // ExternalGlyphsCatalog doesn't exist yet (Sub-project 5).
            // Fall back to a visible placeholder so the menu still opens.
            wrapOffset(layer.x, "□")
        }
    }

    private fun wrapOffset(xPixels: Int, body: String): String =
        if (xPixels == 0) body else "<offset:${xPixels}px>$body</offset>"

    private fun resolveLText(value: LText, langMap: Map<String, String>): String =
        langMap[value.key] ?: value.key
}
