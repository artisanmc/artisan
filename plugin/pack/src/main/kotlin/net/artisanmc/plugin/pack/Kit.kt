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
    class Slot(val id: String, val width: Int, val height: Int)

    /** The base, in the order it is shown. */
    val slots: List<Slot> by lazy {
        ObjectMapper().readTree(resource("slots.json")).map { Slot(it["id"].asText(), it["width"].asInt(), it["height"].asInt()) }
    }

    fun slot(id: String): Slot? = slots.firstOrNull { it.id == id }

    /** The name after `kit:` or `artisan:`; null when [asset] does not say it is a common image. */
    fun nameOf(asset: String): String? = sequenceOf(PREFIX, ALIAS).firstOrNull { asset.startsWith(it) }
        ?.let { asset.substring(it.length) }?.takeIf { it.isNotEmpty() }

    /** The PNG Artisan ships for a slot of the base. */
    fun shipped(slot: Slot): ByteArray = resource("${slot.id}.png")

    /** A kit image's PNG and its size; [shipped] when it is the base's own. */
    class Image(val png: ByteArray, val width: Int, val height: Int, val shipped: Boolean)

    /**
     * What the common image [name] shows: [own] (the server's image of that name) unless it is
     * unreadable or has another size than the base's, then the base's; null when neither exists.
     * [base] is the base image the server holds (`themes/artisan/originals/`), which may be
     * another version of Artisan's than this builder's; without it, the builder's own.
     */
    fun image(name: String, own: ByteArray?, base: ByteArray? = null): Image? {
        val shipped = base?.let { png -> runCatching { Png.decode(png) }.getOrNull()?.let { Image(png, it.width, it.height, true) } }
            ?: slot(name)?.let { Image(shipped(it), it.width, it.height, true) }
        val mine = own?.let { png -> runCatching { Png.decode(png) }.getOrNull()?.let { Image(png, it.width, it.height, false) } }
            ?.takeIf { shipped == null || (it.width == shipped.width && it.height == shipped.height) }
        return mine ?: shipped
    }

    private fun resource(name: String): ByteArray =
        Kit::class.java.getResourceAsStream("kit/$name")?.use { it.readBytes() } ?: error("kit file $name missing from the jar")
}
