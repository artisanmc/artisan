package net.artisanmc.plugin.customitems

import org.yaml.snakeyaml.Yaml
import java.io.File

data class NexoGlyph(val id: String, val texture: String, val available: Boolean)

/**
 * Reads Nexo's glyph configs straight from disk (`plugins/Nexo/glyphs/`, recursively) so the
 * editor can import their textures as Artisan assets. No Nexo API: works even when
 * Nexo is disabled. Bitmap glyphs (one sheet, many chars) are skipped.
 */
class NexoGlyphReader(private val nexoDir: File) {
    private val pack = NexoPack(nexoDir)

    fun list(): List<NexoGlyph> = pack.use { lookup ->
        textures().map { (id, texture) -> NexoGlyph(id, texture, lookup.locate("textures", texture, "png") != null) }
    }

    /** Same lookup Nexo does: `ns:path[.png]`, bare path = `minecraft`. */
    fun read(id: String): ByteArray? = textures()[id]?.let { texture -> pack.use { it.read("textures", texture, "png") } }

    private fun textures(): Map<String, String> {
        val out = linkedMapOf<String, String>()
        val dir = File(nexoDir, "glyphs").takeIf { it.isDirectory } ?: return out
        dir.walkTopDown().filter { it.isFile && it.extension in setOf("yml", "yaml") }.sortedBy { it.path }.forEach { file ->
            val doc = runCatching { Yaml().load<Any?>(file.readText()) }.getOrNull() as? Map<*, *> ?: return@forEach
            for ((id, entry) in doc) {
                val glyph = entry as? Map<*, *> ?: continue
                val texture = glyph["texture"] as? String ?: continue
                if (id is String && "bitmap" !in glyph) out.putIfAbsent(id, texture)
            }
        }
        return out
    }
}
