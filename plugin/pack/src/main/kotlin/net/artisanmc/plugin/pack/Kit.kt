package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper

/**
 * The UI kit: the images a server's menus share. A menu names one `kit:<name>`: the image
 * `<name>` of the server's `ui-kit` module, else the one Artisan ships under that id (the base,
 * `editor/src/assets/kit`). The base's ids and sizes are public and never change, so a module's
 * menus are laid out against them on any server (`kit.ts` in the editor).
 */
object Kit {
    /** The folder of the module that holds a server's kit. */
    const val FOLDER = "ui-kit"

    /** What a menu writes before the image's name. */
    const val PREFIX = "kit:"

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

    /** The name after `kit:`; null when [asset] is not a kit image. */
    fun nameOf(asset: String): String? = asset.takeIf { it.startsWith(PREFIX) }?.substring(PREFIX.length)?.takeIf { it.isNotEmpty() }

    /** The PNG Artisan ships for a slot of the base. */
    fun shipped(slot: Slot): ByteArray = resource("${slot.id}.png")

    /** A kit image's PNG and its size; [shipped] when it is the base's own. */
    class Image(val png: ByteArray, val width: Int, val height: Int, val shipped: Boolean)

    /**
     * What `kit:<name>` shows: [own] (the image of that name in the server's kit module) unless it
     * is unreadable or has another size than the base's, then the base's; null when neither exists.
     */
    fun image(name: String, own: ByteArray?): Image? {
        val slot = slot(name)
        val mine = own?.let { png -> runCatching { Png.decode(png) }.getOrNull()?.let { Image(png, it.width, it.height, false) } }
            ?.takeIf { slot == null || (it.width == slot.width && it.height == slot.height) }
        return mine ?: slot?.let { Image(shipped(it), it.width, it.height, true) }
    }

    private fun resource(name: String): ByteArray =
        Kit::class.java.getResourceAsStream("kit/$name")?.use { it.readBytes() } ?: error("kit file $name missing from the jar")
}
