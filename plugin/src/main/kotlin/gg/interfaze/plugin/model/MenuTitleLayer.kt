package gg.interfaze.plugin.model

/**
 * One layer composed into a menu's GUI title.
 *
 * A menu title is now a list of these layers (see Task 16 of the title-composer plan).
 * Legacy `title: "<string>"` and `title: "{i18n:...}"` YAML values are normalised
 * by [gg.interfaze.plugin.engine.MenuTitleParser] into a single [Text] layer at
 * the default position (x=8, y=5).
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
    ) : MenuTitleLayer()

    /** A glyph from an external provider (Oraxen, Nexo, ItemsAdder…). */
    data class ExternalGlyph(
        val provider: String,
        val glyphName: String,
        val x: Int,
        val y: Int,
    ) : MenuTitleLayer()
}
