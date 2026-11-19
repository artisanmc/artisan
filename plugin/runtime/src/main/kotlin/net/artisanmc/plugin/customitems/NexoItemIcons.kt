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
 * [MAX_SIDE] pixels a side.
 *
 * The editor asks for all of them at once ([sheet]): one pass over the configs and the pack, kept
 * [ttlMillis], and nothing sent to an editor that already holds this [Sheet.hash].
 */
class NexoItemIcons(nexoDir: File, private val ttlMillis: Long = 30_000, private val clock: () -> Long = System::currentTimeMillis) {
    private val itemsDir = File(nexoDir, "items")
    private val pack = NexoPack(nexoDir)
    private val json = ObjectMapper()

    /** Every item with an icon, by Nexo id (no `nexo:`), as PNG bytes; [hash] changes with any of them. */
    class Sheet(val hash: String, val icons: Map<String, ByteArray>)

    private var built: Sheet? = null
    private var builtAt = 0L

    @Synchronized
    fun sheet(): Sheet {
        built?.let { if (clock() - builtAt < ttlMillis) return it }
        return build().also { built = it; builtAt = clock() }
    }

    private fun build(): Sheet {
        val icons = sortedMapOf<String, ByteArray>()
        val items = items()
        if (items.isNotEmpty()) pack.use { lookup ->
            // Many items share a model or a texture (variants): each is resolved and read once.
            val models = hashMapOf<String, String?>()
            val images = hashMapOf<String, ByteArray?>()
            for ((id, item) in items) {
                val texture = textureOf(item) { model -> models.getOrPut(model) { modelTexture(lookup, model) } } ?: continue
                val png = images.getOrPut(texture) {
                    runCatching { lookup.read("textures", texture, "png")?.let(::icon) }.getOrNull()
                } ?: continue
                icons[id] = png
            }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, png) in icons) {
            digest.update(id.toByteArray(Charsets.UTF_8)); digest.update(0); digest.update(png)
        }
        return Sheet(digest.digest().joinToString("") { "%02x".format(it) }.take(32), icons)
    }

    /** The texture ref of an item's config section, null when none resolves. */
    private fun textureOf(item: Map<*, *>, modelTexture: (String) -> String?): String? {
        val packSection = item["Pack"] as? Map<*, *>
        (packSection?.get("texture") as? String)?.takeIf { it.isNotBlank() }?.let { return it }
        when (val textures = packSection?.get("textures")) {
            is List<*> -> textures.firstOrNull { it is String && it.isNotBlank() }?.let { return it as String }
            is Map<*, *> -> pickTexture(textures.entries.mapNotNull { (k, v) -> (v as? String)?.let { k.toString() to it } })
                ?.let { return it }
        }
        val components = item["Components"] as? Map<*, *>
        val model = (packSection?.get("model") as? String)
            ?: (components?.get("item_model") as? String)
            ?: (packSection?.get("item_model") as? String)
            ?: return null
        return modelTexture(model)
    }

    private fun modelTexture(lookup: NexoPack.Lookup, ref: String): String? {
        fun read(kind: String, at: String): JsonNode? =
            lookup.read(kind, at, "json")?.let { runCatching { json.readTree(it) }.getOrNull() }
        // `assets/<ns>/items/<path>.json` (1.21.4+): its `model.model`, a plain model only.
        var model = read("models", ref)
            ?: read("items", ref)?.path("model")?.path("model")?.asText("")?.takeIf { it.isNotEmpty() }?.let { read("models", it) }
        val textures = linkedMapOf<String, String>()
        var depth = 0
        while (model != null && depth <= 4) {
            model.path("textures").fields().forEach { (k, v) -> if (v.isTextual) textures.putIfAbsent(k, v.asText()) }
            val parent = model.path("parent").asText("")
            model = if (parent.isNotEmpty() && !parent.startsWith("builtin/")) read("models", parent) else null
            depth++
        }
        // `#side` points to another key of the same map.
        fun resolve(value: String, hops: Int = 0): String? =
            if (!value.startsWith("#")) value else if (hops > 4) null else textures[value.drop(1)]?.let { resolve(it, hops + 1) }
        return pickTexture(textures.mapNotNull { (k, v) -> resolve(v)?.let { k to it } })
    }

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
        /** The largest side sent to the editor: it draws an icon at 16 to 48 pixels. */
        const val MAX_SIDE = 64

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
        internal fun icon(png: ByteArray): ByteArray {
            val header = pngSize(png)
            if (header != null && header.first == header.second && header.first <= MAX_SIDE) return png
            val image = ImageIO.read(png.inputStream()) ?: return png
            val strip = image.height > image.width && image.height % image.width == 0
            val frame = if (strip) image.getSubimage(0, 0, image.width, image.width) else image
            val scale = minOf(1.0, MAX_SIDE.toDouble() / maxOf(frame.width, frame.height))
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
