package net.artisanmc.plugin.model

/**
 * One layer composed into a menu's GUI title.
 *
 * A menu title is a list of these layers. Legacy `title: "<string>"` and
 * `title: "{i18n:...}"` YAML values are normalised by
 * [net.artisanmc.plugin.engine.MenuTitleParser] into a single [Plain] layer.
 */
sealed class MenuTitleLayer {
    /** A background image rendered at the title origin. */
    data class Background(val assetId: String) : MenuTitleLayer()

    /** A glyph from a project asset, positioned by pixel offsets. */
    data class Glyph(val assetId: String, val x: Int, val y: Int) : MenuTitleLayer()

    /** A text layer with optional font asset and color. */
    data class Text(
        val value: LText,
        val x: Int,
        val y: Int,
        val fontAssetId: String? = null,
        val color: String? = null,
        /** Bitmap font height in MC pixels. Must be in {8,12,16,20,24,32}; the
         *  parser falls back to 8 for invalid values. Ignored when [fontAssetId]
         *  is set — custom fonts ship at their own native size. */
        val size: Int = 8,
    ) : MenuTitleLayer()

    /**
     * A plain vanilla text layer, no resource pack required.
     * Emitted as raw MiniMessage without any custom font wrapper, so the
     * vanilla MC font renders it exactly as the client expects. Servers that
     * don't distribute a resource pack should use this instead of [Text].
     */
    data class Plain(val value: LText, val color: String? = null) : MenuTitleLayer()

    /** A glyph from an external provider (Oraxen, Nexo, ItemsAdder…). */
    data class ExternalGlyph(
        val provider: String,
        val glyphName: String,
        val x: Int,
        val y: Int,
    ) : MenuTitleLayer()

    /** Alignment of each line inside a [Textarea] layer. */
    enum class Alignment { LEFT, CENTER, RIGHT }

    /**
     * A multi-line text block. The resolved [LText] string is split on `\n`
     * at compile time; each line is rendered at `(layer.x, layer.y + i * lineHeight)`
     * with the same [alignment]. Coexists with [Text] (single-line, no
     * line-height/alignment).
     */
    data class Textarea(
        val value: LText,
        val x: Int,
        val y: Int,
        val width: Int,
        val lineHeight: Int,
        val alignment: Alignment,
        val fontAssetId: String? = null,
        /** See [Text.size]. */
        val size: Int = 8,
    ) : MenuTitleLayer()
}
