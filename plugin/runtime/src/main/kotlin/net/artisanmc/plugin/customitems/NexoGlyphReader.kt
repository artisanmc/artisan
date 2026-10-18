package net.artisanmc.plugin.customitems

import org.yaml.snakeyaml.Yaml
import java.io.File
import java.util.zip.ZipFile

data class NexoGlyph(val id: String, val texture: String, val available: Boolean)

/**
 * Reads Nexo's glyph configs straight from disk (`plugins/Nexo/glyphs/`, recursively) so the
 * editor can import their textures as Artisan assets. No Nexo API: works even when
 * Nexo is disabled. Bitmap glyphs (one sheet, many chars) are skipped.
 */
class NexoGlyphReader(private val nexoDir: File) {

    fun list(): List<NexoGlyph> = textures().map { (id, texture) -> NexoGlyph(id, texture, locate(texture) != null) }

    fun read(id: String): ByteArray? = textures()[id]?.let { locate(it) }?.invoke()

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

    /** Same lookup Nexo does: `ns:path[.png]`, bare path = `minecraft`. Returns a lazy reader. */
    private fun locate(texture: String): (() -> ByteArray)? {
        val ns = texture.substringBefore(':', "minecraft")
        val path = texture.substringAfter(':').removeSuffix(".png")
        val rel = "assets/$ns/textures/$path.png"
        if (rel.split('/').any { it == ".." || it.isEmpty() }) return null
        val pack = File(nexoDir, "pack")
        val external = File(pack, "external_packs").listFiles()?.sortedBy { it.name }.orEmpty()
        (listOf(pack) + external.filter { it.isDirectory }).forEach { root ->
            val f = File(root, rel)
            if (f.isFile) return { f.readBytes() }
        }
        external.filter { it.isFile && it.extension == "zip" }.forEach { zip ->
            val found = runCatching { ZipFile(zip).use { it.getEntry(rel) != null } }.getOrDefault(false)
            if (found) return { ZipFile(zip).use { z -> z.getInputStream(z.getEntry(rel)).readBytes() } }
        }
        return null
    }
}
