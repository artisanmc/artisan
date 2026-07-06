package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer

/**
 * Parses the `title` field of a menu YAML into a typed list of [MenuTitleLayer].
 *
 * Accepts four shapes for tolerance:
 *  - `null` / empty string → empty list (no title)
 *  - a bare string (legacy) → one [MenuTitleLayer.Text] wrapping the string at (8, 5).
 *    If the string is of the form `{i18n:foo.bar}`, the `foo.bar` key is unwrapped;
 *    otherwise the string is stored as an inline literal (see [LText]).
 *  - a single map → one-element list
 *  - a list of maps → list of layers
 *
 * Unknown `kind` values are silently dropped so that future kinds added by the editor
 * don't break older plugin builds.
 */
object MenuTitleParser {

    /** Default position used for legacy bare-string titles (matches the editor default). */
    private const val DEFAULT_TEXT_X = 8
    private const val DEFAULT_TEXT_Y = 5

    @Suppress("UNCHECKED_CAST")
    fun parse(node: Any?): List<MenuTitleLayer> = when (node) {
        null -> emptyList()
        // Legacy bare-string format → plain vanilla layer (no resource pack needed).
        is String -> if (node.isEmpty()) emptyList() else listOf(
            MenuTitleLayer.Plain(value = literalToLText(node))
        )
        is Map<*, *> -> listOfNotNull(parseLayer(node as Map<String, Any?>))
        is List<*> -> node.mapNotNull { (it as? Map<String, Any?>)?.let(::parseLayer) }
        else -> emptyList()
    }

    private fun parseLayer(m: Map<String, Any?>): MenuTitleLayer? {
        return when (m["kind"]) {
            "background" -> MenuTitleLayer.Background(
                assetId = m["asset_id"] as? String ?: return null,
            )
            "glyph" -> MenuTitleLayer.Glyph(
                assetId = m["asset_id"] as? String ?: return null,
                x = (m["x"] as? Number)?.toInt() ?: 0,
                y = (m["y"] as? Number)?.toInt() ?: 0,
            )
            "text" -> MenuTitleLayer.Text(
                value = parseLText(m["value"]),
                x = (m["x"] as? Number)?.toInt() ?: 0,
                y = (m["y"] as? Number)?.toInt() ?: 0,
                fontAssetId = m["font_asset_id"] as? String,
                color = m["color"] as? String,
                size = parseSize(m["size"]),
            )
            "textarea" -> MenuTitleLayer.Textarea(
                value = parseLText(m["value"]),
                x = (m["x"] as? Number)?.toInt() ?: 0,
                y = (m["y"] as? Number)?.toInt() ?: 0,
                width = ((m["width"] as? Number)?.toInt() ?: 168).coerceIn(8, 256),
                lineHeight = ((m["line_height"] as? Number)?.toInt() ?: 10).coerceIn(1, 32),
                alignment = parseAlignment(m["alignment"] as? String),
                fontAssetId = m["font_asset_id"] as? String,
                size = parseSize(m["size"]),
            )
            "external_glyph" -> MenuTitleLayer.ExternalGlyph(
                provider = m["provider"] as? String ?: return null,
                glyphName = m["glyph_name"] as? String ?: return null,
                x = (m["x"] as? Number)?.toInt() ?: 0,
                y = (m["y"] as? Number)?.toInt() ?: 0,
            )
            "plain" -> MenuTitleLayer.Plain(
                value = parseLText(m["value"]),
                color = m["color"] as? String,
            )
            else -> null // unknown kind → skip
        }
    }

    private val ALLOWED_SIZES = setOf(8, 12, 16, 20, 24, 32)

    private fun parseSize(v: Any?): Int {
        val n = (v as? Number)?.toInt() ?: return 8
        return if (n in ALLOWED_SIZES) n else 8
    }

    private fun parseAlignment(s: String?): MenuTitleLayer.Alignment = when (s?.lowercase()) {
        "center" -> MenuTitleLayer.Alignment.CENTER
        "right" -> MenuTitleLayer.Alignment.RIGHT
        else -> MenuTitleLayer.Alignment.LEFT
    }

    private fun parseLText(v: Any?): LText = when (v) {
        is String -> literalToLText(v)
        is Map<*, *> -> LText(key = v["key"] as? String ?: "")
        else -> LText(key = "")
    }

    /**
     * String-valued text: `{i18n:foo.bar}` unwraps to the bare key; anything
     * else is inline literal text (hybrid export) — also covers the legacy
     * bare-string `title:` shape.
     */
    private fun literalToLText(raw: String): LText {
        if (raw.startsWith("{i18n:") && raw.endsWith("}")) {
            return LText(key = raw.removePrefix("{i18n:").removeSuffix("}"))
        }
        return LText(literal = raw)
    }
}
