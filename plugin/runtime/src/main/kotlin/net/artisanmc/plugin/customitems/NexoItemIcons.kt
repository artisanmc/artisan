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
 * The flat icons of the Nexo items, read from disk like the glyphs ([NexoGlyphReader]): an item's
 * config in `plugins/Nexo/items/` (recursively) names a texture or a model, and the PNG comes from
 * Nexo's pack. No Nexo API: works even when Nexo is disabled.
 *
 * In order: `Pack.texture`, `Pack.textures` (the first of the list, `layer0` of a map), then the model
 * (`Pack.model`, else the `item_model` component; an 1.21.4 item definition is followed to its model),
 * whose `layer0` texture, else a face of a block model, is taken, through 4 `parent`s at most.
 * An animated texture (a vertical strip of square frames) gives its first frame; an icon is at most
 * [MAX_SIDE] pixels a side. A model with `elements` (its own, a parent's, or a vanilla full block's)
 * is also given whole ([Models]) for the editor to draw it in 3D.
 *
 * The editor asks for all of them at once ([sheet]): one pass over the configs and the pack, kept
 * [ttlMillis], and nothing sent to an editor that already holds this [Sheet.hash].
 */
class NexoItemIcons(nexoDir: File, private val ttlMillis: Long = 30_000, private val clock: () -> Long = System::currentTimeMillis) {
    private val itemsDir = File(nexoDir, "items")
    private val pack = NexoPack(nexoDir)
    private val json = ObjectMapper()

    /**
     * Every item with an icon, by Nexo id (no `nexo:`), as PNG bytes; [hash] changes with any of them.
     * [models]: the items whose model is drawn in 3D, for the editor to render.
     */
    class Sheet(val hash: String, val icons: Map<String, ByteArray>, val models: Models)

    /**
     * The 3D models of the items that have one: [items] gives an item's model key, [models] a model
     * once (`elements`, `textures` as variable → key of [textures], `display` = its `display.gui`,
     * `gui_light`), [textures] a PNG once, [MAX_TEXTURE_SIDE] pixels a side at most.
     */
    class Models(
        val hash: String,
        val items: Map<String, String>,
        val models: Map<String, Map<String, Any?>>,
        val textures: Map<String, ByteArray>,
    )

    /** A model with its parents merged: every texture variable resolved to a texture ref. */
    private class Resolved(val textures: Map<String, String>, val elements: JsonNode?, val display: JsonNode?, val guiLight: String?)

    private var built: Sheet? = null
    private var builtAt = 0L

    @Synchronized
    fun sheet(): Sheet {
        built?.let { if (clock() - builtAt < ttlMillis) return it }
        return build().also { built = it; builtAt = clock() }
    }

    private fun build(): Sheet {
        val icons = sortedMapOf<String, ByteArray>()
        val modelOf = sortedMapOf<String, String>()
        val models = sortedMapOf<String, Map<String, Any?>>()
        val textures = sortedMapOf<String, ByteArray>()
        val items = items()
        if (items.isNotEmpty()) pack.use { lookup ->
            // Many items share a model or a texture (variants): each is resolved and read once.
            val resolved = hashMapOf<String, Resolved?>()
            val images = hashMapOf<String, ByteArray?>()
            val modelImages = hashMapOf<String, ByteArray?>()
            val drawn = hashMapOf<String, Boolean>()
            for ((id, item) in items) {
                val model = modelOf(item)?.let { (key, read) -> resolved.getOrPut(key) { read(lookup) }?.let { key to it } }
                val texture = flatTexture(item) ?: model?.second?.let { pickTexture(it.textures.toList()) }
                if (texture != null) images.getOrPut(texture) {
                    runCatching { lookup.read("textures", texture, "png")?.let { icon(it, MAX_SIDE) } }.getOrNull()
                }?.let { icons[id] = it }
                if (model == null) continue
                val (key, shape) = model
                val usable = drawn.getOrPut(key) {
                    val elements = shape.elements?.takeIf { it.size() in 1..MAX_ELEMENTS } ?: return@getOrPut false
                    val pngs = shape.textures.values.distinct().associateWith { ref ->
                        modelImages.getOrPut(ref) {
                            runCatching { lookup.read("textures", ref, "png")?.let { icon(it, MAX_TEXTURE_SIDE) } }.getOrNull()
                        }
                    }
                    val present = shape.textures.filterValues { pngs[it] != null }
                    if (present.isEmpty()) return@getOrPut false
                    present.values.forEach { textures[it] = pngs.getValue(it)!! }
                    models[key] = buildMap {
                        put("elements", elements)
                        put("textures", present)
                        shape.display?.let { put("display", it) }
                        shape.guiLight?.let { put("gui_light", it) }
                    }
                    true
                }
                if (usable) modelOf[id] = key
            }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, png) in icons) {
            digest.update(id.toByteArray(Charsets.UTF_8)); digest.update(0); digest.update(png)
        }
        val shapes = MessageDigest.getInstance("SHA-256")
        shapes.update(json.writeValueAsBytes(mapOf("items" to modelOf, "models" to models)))
        for ((ref, png) in textures) {
            shapes.update(ref.toByteArray(Charsets.UTF_8)); shapes.update(0); shapes.update(png)
        }
        return Sheet(hex(digest), icons, Models(hex(shapes), modelOf, models, textures))
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
        if (!itemsDir.isDirectory) return emptyMap()
        val out = linkedMapOf<String, Map<*, *>>()
        itemsDir.walkTopDown().filter { it.isFile && it.extension in setOf("yml", "yaml") }.sortedBy { it.path }.forEach { file ->
            val doc = runCatching { Yaml().load<Any?>(file.readText()) }.getOrNull() as? Map<*, *> ?: return@forEach
            for ((id, entry) in doc) if (id is String && entry is Map<*, *>) out.putIfAbsent(id, entry)
        }
        return out
    }

    companion object {
        /** The largest side of a flat icon: the editor draws one at 16 to 48 pixels. */
        const val MAX_SIDE = 64

        /** The largest side of a 3D model's texture: the editor renders a model at 256 pixels. */
        const val MAX_TEXTURE_SIDE = 128

        /** Beyond this a model is not sent: the item keeps its flat icon. */
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

        /** Width and height from the IHDR chunk, null when [png] is not a PNG. */
        private fun pngSize(png: ByteArray): Pair<Int, Int>? {
            if (png.size < 24 || png[1] != 'P'.code.toByte() || png[2] != 'N'.code.toByte() || png[3] != 'G'.code.toByte()) return null
            fun int(at: Int) = ((png[at].toInt() and 0xff) shl 24) or ((png[at + 1].toInt() and 0xff) shl 16) or
                ((png[at + 2].toInt() and 0xff) shl 8) or (png[at + 3].toInt() and 0xff)
            return int(16) to int(20)
        }
    }
}
