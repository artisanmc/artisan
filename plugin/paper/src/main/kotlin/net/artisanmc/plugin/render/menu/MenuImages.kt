package net.artisanmc.plugin.render.menu

import net.artisanmc.plugin.model.ImageButtonYaml
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.render.ImageRefs
import net.artisanmc.plugin.resourcepack.AssetEntry

/**
 * The images a menu names, read as its module's (ADR `common-images-and-themes`, decision 3): a
 * module's own image first, by the ids of the pack's asset index ([ImageRefs]). [module] is the
 * menu's Project folder, `""` for a menu without one.
 */
class MenuImages(private val module: String, private val lookup: (String) -> AssetEntry?) {
    /** The pack id of the image [ref] names in this menu. */
    fun id(ref: String): String = ImageRefs.resolve({ lookup(it) != null }, module, ref)

    /** [layers] with each image under its pack id; a text's font keeps its name (a font is the server's). */
    fun title(layers: List<MenuTitleLayer>): List<MenuTitleLayer> = layers.map {
        when (it) {
            is MenuTitleLayer.Background -> it.copy(assetId = id(it.assetId))
            is MenuTitleLayer.Glyph -> it.copy(assetId = id(it.assetId))
            else -> it
        }
    }

    /** The key of [image] drawn in [layout], as the pack builder wrote it. */
    fun key(layout: ImageButtonLayout, image: ImageButtonYaml): String = layout.assetKey(image, id(image.asset))
}
