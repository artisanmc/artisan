package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper

/**
 * The common images: the ones every menu of a server may name (ADR `common-images-and-themes`).
 * They are the theme `artisan`'s: the image `<name>` the server keeps in `themes/artisan/assets/`,
 * else the one Artisan ships under that name (the base, `editor/src/assets/kit`, written on the
 * server as `themes/artisan/originals/`). A menu names one by its name alone when its module
 * holds none of that name, or `artisan:<name>`; `kit:<name>` is the former spelling, still read.
 * The base's names and sizes are public and never change, so a module's menus are laid out
 * against them on any server (`kit.ts` in the editor).
 *
 * In the pack a common image keeps the id `kit:<name>` ([PREFIX]), whatever the menu wrote.
 */
object Kit {
    /** The theme that holds a server's common images: its folder and its Project. */
    const val FOLDER = "artisan"

    /** The module that held them before the theme: read as the theme on a server that has no theme `artisan`. */
    const val LEGACY_FOLDER = "ui-kit"

    /** A common image's id in the pack, before its name; also what a menu wrote before `artisan:`. */
    const val PREFIX = "kit:"

    /** What a menu writes before a common image's name, to name it even when its module holds one. */
    const val ALIAS = "$FOLDER:"

    /** Where the theme keeps the base Artisan ships, before the image's name. */
    private const val SHIPPED_DIR = "originals/assets/textures/"

    /** The folder the common images are read from, among [folders]. */
    fun folderAmong(folders: Collection<String>): String = if (FOLDER in folders || LEGACY_FOLDER !in folders) FOLDER else LEGACY_FOLDER

    /** The path of the base image [name] in the theme's folder. */
    fun shippedPath(name: String) = "$SHIPPED_DIR$name.png"

    /** The name of the base image kept at [path] in the theme's folder; null for another file. */
    fun shippedName(path: String): String? =
        path.takeIf { it.startsWith(SHIPPED_DIR) && it.endsWith(".png") }?.substring(SHIPPED_DIR.length)?.removeSuffix(".png")?.takeIf { it.isNotEmpty() && '/' !in it }

    /** Where a kit image's files go in the pack, before its name (`:` cannot be in a pack's path). */
    internal const val FILES = "kit/"

    /** A kit image drawn in a title sits from the window's top edge, as a container's texture does. */
    const val ASCENT = 13.0

    /** One image of the base: its id, and the size every image under that id has. */
    class Slot(
        val id: String, val width: Int, val height: Int,
        /** The margins the base's drawing keeps when a button is larger than it (`slice`); null: drawn at its size. */
        val slice: Slice? = null,
        /** A coloured variant: what its drawing is made of ([Tint]); null for an image drawn as it is. */
        val tint: Tint? = null,
    )

    /**
     * A coloured variant of the base (ADR `component-colours`, decision 3): its drawing is the
     * image [of] as the server shows it, multiplied by the palette's colour [color]. The PNG
     * shipped under its id is that drawing with the default palette.
     */
    class Tint(val of: String, val color: String)

    /** The base, in the order it is shown. */
    val slots: List<Slot> by lazy {
        ObjectMapper().readTree(resource("slots.json")).map { node ->
            val slice = node["slice"]?.let { Slice(it["left"].asInt(), it["right"].asInt(), it["top"].asInt(), it["bottom"].asInt()) }
            val tint = node["tint"]?.let { Tint(it["of"].asText(), it["color"].asText()) }
            Slot(node["id"].asText(), node["width"].asInt(), node["height"].asInt(), slice, tint)
        }
    }

    fun slot(id: String): Slot? = slots.firstOrNull { it.id == id }

    /**
     * The components Artisan ships (`components.json`, `components/<name>.yml`): each file's text
     * by its name. The server writes them as `themes/artisan/originals/components/`, where a
     * menu's `component: confirm` finds them unless the server wrote one of that name.
     */
    val components: Map<String, String> by lazy {
        ObjectMapper().readTree(resource("components.json")).associate { node ->
            node.asText() to resource("components/${node.asText()}.yml").toString(Charsets.UTF_8)
        }
    }

    /** The name after `kit:` or `artisan:`; null when [asset] does not say it is a common image. */
    fun nameOf(asset: String): String? = sequenceOf(PREFIX, ALIAS).firstOrNull { asset.startsWith(it) }
        ?.let { asset.substring(it.length) }?.takeIf { it.isNotEmpty() }

    /** The PNG Artisan ships for a slot of the base. */
    fun shipped(slot: Slot): ByteArray = resource("${slot.id}.png")

    /** A kit image's PNG and its size; [shipped] when it is the base's own. */
    class Image(val png: ByteArray, val width: Int, val height: Int, val shipped: Boolean)

    /**
     * What the common image [name] shows: [own] (the server's image of that name), whatever its
     * size (ADR `resources-one-screen`, decision 4), unless it is unreadable, then the base's;
     * null when neither exists.
     * [base] is the base image the server holds (`themes/artisan/originals/`), which may be
     * another version of Artisan's than this builder's; without it, the builder's own.
     */
    fun image(name: String, own: ByteArray?, base: ByteArray? = null): Image? {
        val shipped = base?.let { png -> runCatching { Png.decode(png) }.getOrNull()?.let { Image(png, it.width, it.height, true) } }
            ?: slot(name)?.let { Image(shipped(it), it.width, it.height, true) }
        val mine = own?.let { png -> runCatching { Png.decode(png) }.getOrNull()?.let { Image(png, it.width, it.height, false) } }
        return mine ?: shipped
    }

    /**
     * The base's drawing of the coloured variant [image] ([Tint]) in [palette]: [neutral] (its
     * [Tint.of] as the server and its themes show it) multiplied by the colour. [image] itself
     * when it is the server's own, when the slot is no variant, or when nothing can be tinted.
     */
    fun tinted(name: String, image: Image, palette: Palette, neutral: (String) -> ByteArray?): Image {
        val tint = slot(name)?.tint?.takeIf { image.shipped } ?: return image
        val colour = ComposedImages.tintColour(palette.colour(tint.color)) ?: return image
        val source = neutral(tint.of)?.let { runCatching { Png.decode(it) }.getOrNull() } ?: return image
        return Image(Png.encode(ComposedImages.tinted(source, colour)), source.width, source.height, true)
    }

    private fun resource(name: String): ByteArray =
        Kit::class.java.getResourceAsStream("kit/$name")?.use { it.readBytes() } ?: error("kit file $name missing from the jar")
}
