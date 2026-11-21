package net.artisanmc.plugin.customitems

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.yaml.snakeyaml.Yaml
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import javax.imageio.ImageIO

/**
 * The icons of the Nexo items, read from disk like the glyphs ([NexoGlyphReader]): an item's
 * config in `plugins/Nexo/items/` (recursively) names a texture or a model, and the PNG comes from
 * Nexo's pack. No Nexo API: works even when Nexo is disabled.
 *
 * In order: `Pack.texture`, `Pack.textures` (the first of the list, `layer0` of a map), then the model
 * (`Pack.model`, else the `item_model` component; an 1.21.4 item definition is followed to its model),
 * whose `layer0` texture, else a face of a block model, is taken, through 4 `parent`s at most.
 * An animated texture (a vertical strip of square frames) gives its first frame; a flat icon is at most
 * [MAX_SIDE] pixels a side. A model with `elements` (its own, a parent's, or a vanilla full block's)
 * is drawn here as the game draws it in a slot ([ModelPainter]), [RENDER_SIDE] pixels a side: the
 * editor gets a picture, never the model. A server holds thousands of models, far too much to send.
 *
 * The editor asks for all of them at once ([sheet]): one pass over the configs and the pack, kept
 * [ttlMillis], then for as long as Nexo's files have not changed, and nothing sent to an editor that
 * already holds this [Sheet.hash]. A model is drawn once for the life of the server.
 */
class NexoItemIcons(nexoDir: File, private val ttlMillis: Long = 30_000, private val clock: () -> Long = System::currentTimeMillis) {
    private val itemsDir = File(nexoDir, "items")
    private val pack = NexoPack(nexoDir)
    private val json = ObjectMapper()

    /**
     * Every item with an icon, by Nexo id (no `nexo:`), as PNG bytes; [hash] changes with any of them.
     * [drawn]: the items whose icon is their model drawn in 3D, which the editor shows smoothed.
     */
    class Sheet(val hash: String, val icons: Map<String, ByteArray>, val drawn: Set<String>)

    /** A model with its parents merged: every texture variable resolved to a texture ref. */
    private class Resolved(val textures: Map<String, String>, val elements: JsonNode?, val display: JsonNode?, val guiLight: String?)

    private var built: Sheet? = null
    private var builtAt = 0L
    private var builtFrom: String? = null

    /** A model's picture by what it was drawn from; null: nothing of it is visible. */
    private val pictures = hashMapOf<String, ByteArray?>()

    @Synchronized
    fun sheet(): Sheet {
        built?.let { if (clock() - builtAt < ttlMillis) return it }
        // Reading every config and model again costs seconds on a large pack: not while Nexo's files stand still.
        val state = state()
        built?.let { if (state != null && state == builtFrom) return it.also { builtAt = clock() } }
        return build().also { built = it; builtAt = clock(); builtFrom = state }
    }

    /**
     * What tells that Nexo's files changed: the item configs, and the pack Nexo generates from all
     * its sources (rewritten on every Nexo reload). Null without that pack: nothing to go by.
     */
    private fun state(): String? {
        val generated = File(File(itemsDir.parentFile, "pack"), "pack.zip").takeIf { it.isFile } ?: return null
        val digest = MessageDigest.getInstance("SHA-256")
        fun add(file: File) = digest.update("${file.path}|${file.length()}|${file.lastModified()}\n".toByteArray(Charsets.UTF_8))
        add(generated)
        itemFiles().forEach(::add)
        return hex(digest)
    }

    private fun build(): Sheet {
        val icons = sortedMapOf<String, ByteArray>()
        val drawn = sortedSetOf<String>()
        val items = items()
        if (items.isNotEmpty()) pack.use { lookup ->
            // Many items share a model or a texture (variants): each is resolved and read once.
            val resolved = hashMapOf<String, Resolved?>()
            val images = hashMapOf<String, ByteArray?>()
            val raw = hashMapOf<String, ByteArray?>()
            val decoded = hashMapOf<String, BufferedImage?>()
            val painted = hashMapOf<String, ByteArray?>()
            for ((id, item) in items) {
                val model = modelOf(item)?.let { (key, read) -> resolved.getOrPut(key) { read(lookup) }?.let { key to it } }
                val picture = model?.let { (key, shape) ->
                    painted.getOrPut(key) {
                        val elements = shape.elements?.takeIf { it.size() in 1..MAX_ELEMENTS } ?: return@getOrPut null
                        val bytes = shape.textures.mapValues { (_, ref) ->
                            raw.getOrPut(ref) { runCatching { lookup.read("textures", ref, "png") }.getOrNull() }
                        }
                        // Drawn once for this model and these textures, however often the pack is read again.
                        val digest = MessageDigest.getInstance("SHA-256")
                        digest.update(json.writeValueAsBytes(listOf(elements, shape.display, shape.guiLight)))
                        for ((variable, png) in bytes.toSortedMap()) {
                            digest.update(variable.toByteArray(Charsets.UTF_8)); digest.update(0); png?.let(digest::update)
                        }
                        pictures.getOrPut(hex(digest)) {
                            val textures = shape.textures.mapNotNull { (variable, ref) ->
                                decoded.getOrPut(ref) { bytes[variable]?.let(::frame) }?.let { variable to it }
                            }.toMap()
                            if (textures.isEmpty()) return@getOrPut null
                            runCatching {
                                ModelPainter.paint(elements, textures, shape.display, shape.guiLight, RENDER_SIDE)?.let(::png)
                            }.getOrNull()
                        }
                    }
                }
                if (picture != null) {
                    icons[id] = picture
                    drawn += id
                    continue
                }
                val texture = flatTexture(item) ?: model?.second?.let { pickTexture(it.textures.toList()) }
                if (texture != null) images.getOrPut(texture) {
                    runCatching { lookup.read("textures", texture, "png")?.let { icon(it, MAX_SIDE) } }.getOrNull()
                }?.let { icons[id] = it }
            }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, png) in icons) {
            digest.update(id.toByteArray(Charsets.UTF_8)); digest.update(if (id in drawn) 1 else 0); digest.update(png)
        }
        return Sheet(hex(digest), icons, drawn)
    }

    private fun hex(digest: MessageDigest) = digest.digest().joinToString("") { "%02x".format(it) }.take(32)

    /** The texture an item's config names itself, null when it only names a model. */
    private fun flatTexture(item: Map<*, *>): String? {
        val packSection = item["Pack"] as? Map<*, *>
        (packSection?.get("texture") as? String)?.takeIf { it.isNotBlank() }?.let { return it }
        return when (val textures = packSection?.get("textures")) {
            is List<*> -> textures.firstOrNull { it is String && it.isNotBlank() } as String?
            is Map<*, *> -> pickTexture(textures.entries.mapNotNull { (k, v) -> (v as? String)?.let { k.toString() to it } })
            else -> null
        }
    }

    /**
     * The model of an item's config, as a key and how to read it: its model file, or the block Nexo
     * generates from `parent_model` (a vanilla cube) and `textures`. Null when it has neither.
     */
    private fun modelOf(item: Map<*, *>): Pair<String, (NexoPack.Lookup) -> Resolved?>? {
        val packSection = item["Pack"] as? Map<*, *>
        val components = item["Components"] as? Map<*, *>
        val file = (packSection?.get("model") as? String)
            ?: (components?.get("item_model") as? String)
            ?: (packSection?.get("item_model") as? String)
        if (file != null) return file to { lookup -> resolve(lookup, file) }
        val parent = (packSection?.get("parent_model") as? String)?.removePrefix("minecraft:") ?: return null
        val faces = CUBES[parent] ?: return null
        val textures: Map<String, String> = when (val given = packSection["textures"]) {
            is Map<*, *> -> given.entries.mapNotNull { (k, v) -> (v as? String)?.let { k.toString() to it } }.toMap()
            // A list is in an order only `cube_all` makes obvious: its one texture.
            is List<*> -> (given.firstOrNull() as? String)?.takeIf { parent == "block/cube_all" }?.let { mapOf("all" to it) }.orEmpty()
            else -> (packSection["texture"] as? String)?.takeIf { parent == "block/cube_all" }?.let { mapOf("all" to it) }.orEmpty()
        }
        if (faces.values.any { it !in textures }) return null
        return "$parent${textures.toSortedMap()}" to { _ -> Resolved(textures, cube(faces), null, null) }
    }

    /** [ref]'s model file with its parents merged, the nearest `elements`, `display.gui` and `gui_light` kept. */
    private fun resolve(lookup: NexoPack.Lookup, ref: String): Resolved? {
        fun read(kind: String, at: String): JsonNode? =
            lookup.read(kind, at, "json")?.let { runCatching { json.readTree(it) }.getOrNull() }
        // `assets/<ns>/items/<path>.json` (1.21.4+): its `model.model`, a plain model only.
        var model = read("models", ref)
            ?: read("items", ref)?.path("model")?.path("model")?.asText("")?.takeIf { it.isNotEmpty() }?.let { read("models", it) }
            ?: return null
        val textures = linkedMapOf<String, String>()
        var elements: JsonNode? = null
        var display: JsonNode? = null
        var guiLight: String? = null
        var depth = 0
        while (true) {
            model.path("textures").fields().forEach { (k, v) -> if (v.isTextual) textures.putIfAbsent(k, v.asText()) }
            if (elements == null) elements = model.path("elements").takeIf { it.isArray && it.size() > 0 }
            if (display == null) display = model.path("display").path("gui").takeIf { it.isObject }
            if (guiLight == null) guiLight = model.path("gui_light").asText("").takeIf { it.isNotEmpty() }
            val parent = model.path("parent").asText("").removePrefix("minecraft:")
            if (parent.isEmpty() || parent.startsWith("builtin/") || ++depth > 4) break
            // A vanilla cube is not in Nexo's pack: its shape is known.
            model = read("models", parent) ?: run {
                if (elements == null) elements = CUBES[parent]?.let(::cube)
                null
            } ?: break
        }
        // `#side` points to another key of the same map.
        fun follow(value: String, hops: Int = 0): String? =
            if (!value.startsWith("#")) value else if (hops > 4) null else textures[value.drop(1)]?.let { follow(it, hops + 1) }
        return Resolved(textures.mapNotNull { (k, v) -> follow(v)?.takeIf { it.isNotBlank() }?.let { k to it } }.toMap(), elements, display, guiLight)
    }

    /** A full block whose faces take the texture variables of [faces]. */
    private fun cube(faces: Map<String, String>): JsonNode = json.valueToTree(
        listOf(mapOf("from" to listOf(0, 0, 0), "to" to listOf(16, 16, 16), "faces" to faces.mapValues { mapOf("texture" to "#${it.value}") })),
    )

    private fun items(): Map<String, Map<*, *>> {
        val out = linkedMapOf<String, Map<*, *>>()
        itemFiles().forEach { file ->
            val doc = runCatching { Yaml().load<Any?>(file.readText()) }.getOrNull() as? Map<*, *> ?: return@forEach
            for ((id, entry) in doc) if (id is String && entry is Map<*, *>) out.putIfAbsent(id, entry)
        }
        return out
    }

    private fun itemFiles(): List<File> =
        if (!itemsDir.isDirectory) emptyList()
        else itemsDir.walkTopDown().filter { it.isFile && it.extension in setOf("yml", "yaml") }.sortedBy { it.path }.toList()

    companion object {
        /** The largest side of a flat icon: the editor draws one at 16 to 48 pixels. */
        const val MAX_SIDE = 64

        /** The side of a model drawn in 3D: the editor shows an icon at 16 to 48 pixels, twice that on a dense screen. */
        const val RENDER_SIDE = 64

        /** Beyond this a model is not drawn: the item keeps its flat icon. */
        const val MAX_ELEMENTS = 1024

        private val SIDES = listOf("north", "south", "west", "east")
        private fun faces(up: String, down: String, side: (String) -> String) =
            mapOf("up" to up, "down" to down) + SIDES.associateWith(side)

        /** The vanilla full-block parents, as the texture variable of each face. */
        private val CUBES: Map<String, Map<String, String>> = mapOf(
            "block/cube_all" to faces("all", "all") { "all" },
            "block/cube" to faces("up", "down") { it },
            "block/cube_column" to faces("end", "end") { "side" },
            "block/cube_bottom_top" to faces("top", "bottom") { "side" },
            "block/cube_top" to faces("top", "side") { "side" },
            "block/orientable" to faces("top", "top") { if (it == "north") "front" else "side" },
            "block/orientable_with_bottom" to faces("top", "bottom") { if (it == "north") "front" else "side" },
        )

        /** Item layer first, then the faces a player sees on a block icon. */
        private val PREFERRED = listOf("layer0", "all", "side", "front", "north", "top", "texture", "particle")

        private fun pickTexture(textures: List<Pair<String, String>>): String? {
            val usable = textures.filter { (_, v) -> v.isNotBlank() && !v.startsWith("#") }
            return PREFERRED.firstNotNullOfOrNull { key -> usable.firstOrNull { it.first == key }?.second }
                ?: usable.firstOrNull()?.second
        }

        /**
         * [png] as an icon. A small square one, the usual case, goes untouched and undecoded (its
         * size is read from the PNG header); a strip of frames gives its first, a large one is scaled down.
         */
        internal fun icon(png: ByteArray, maxSide: Int): ByteArray {
            val header = pngSize(png)
            if (header != null && header.first == header.second && header.first <= maxSide) return png
            val image = ImageIO.read(png.inputStream()) ?: return png
            val strip = image.height > image.width && image.height % image.width == 0
            val frame = if (strip) image.getSubimage(0, 0, image.width, image.width) else image
            val scale = minOf(1.0, maxSide.toDouble() / maxOf(frame.width, frame.height))
            if (!strip && scale == 1.0) return png
            val w = maxOf(1, (frame.width * scale).toInt())
            val h = maxOf(1, (frame.height * scale).toInt())
            val out = BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB)
            out.createGraphics().apply {
                setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR)
                drawImage(frame, 0, 0, w, h, null)
                dispose()
            }
            return ByteArrayOutputStream().also { ImageIO.write(out, "png", it) }.toByteArray()
        }

        /** [png] decoded, its first frame when it is a vertical strip of frames; null when it is not an image. */
        private fun frame(png: ByteArray): BufferedImage? {
            val image = runCatching { ImageIO.read(png.inputStream()) }.getOrNull() ?: return null
            val strip = image.height > image.width && image.height % image.width == 0
            return if (strip) image.getSubimage(0, 0, image.width, image.width) else image
        }

        private fun png(image: BufferedImage): ByteArray = ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()

        /** Width and height from the IHDR chunk, null when [png] is not a PNG. */
        private fun pngSize(png: ByteArray): Pair<Int, Int>? {
            if (png.size < 24 || png[1] != 'P'.code.toByte() || png[2] != 'N'.code.toByte() || png[3] != 'G'.code.toByte()) return null
            fun int(at: Int) = ((png[at].toInt() and 0xff) shl 24) or ((png[at + 1].toInt() and 0xff) shl 16) or
                ((png[at + 2].toInt() and 0xff) shl 8) or (png[at + 3].toInt() and 0xff)
            return int(16) to int(20)
        }
    }
}
