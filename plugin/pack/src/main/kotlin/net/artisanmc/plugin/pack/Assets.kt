package net.artisanmc.plugin.pack

import java.security.MessageDigest

/** A font unpacked on disk (`assets/fonts/<name>/font.yml`): one PNG per glyph. */
internal data class FontGlyph(val char: String, val texture: String, val ascent: Double, val height: Double)

internal data class FontMeta(val namespace: String, val glyphMap: List<FontGlyph>)

/**
 * An asset as the pack reads it (`AssetRow` in the editor). Numbers stay JavaScript numbers
 * (doubles): a hand-written descriptor may hold `12.5`, and the pack writes it as it is.
 */
internal data class AssetRow(
    val id: String,
    val projectId: String,
    val type: String,
    val name: String,
    val width: Double,
    val height: Double,
    val ascent: Double?,
    val codepoint: Double?,
    val contentWidth: Double?,
    /** A disk font's [FontMeta], or a binary's `font_meta` as parsed YAML. */
    val fontMeta: Any?,
)

internal class DiskAsset(val row: AssetRow, val path: String)

internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

internal fun sha1Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }

/** `.yml` then `.yaml`, as the plugin's `YamlFiles` and the editor's `yamlFiles.ts`. */
internal object YamlPaths {
    private val EXTENSIONS = listOf(".yml", ".yaml")

    fun isYaml(path: String) = EXTENSIONS.any { path.endsWith(it) }

    fun stem(path: String): String? = EXTENSIONS.firstOrNull { path.endsWith(it) }?.let { path.dropLast(it.length) }
}

/**
 * A Project's assets read from its files (`diskAssets.ts`): an image's identity is its file name,
 * its sibling descriptor gives what the PNG cannot say. An unreadable descriptor leaves the image
 * usable with defaults; a font is a folder with a `font.yml` and one PNG per glyph.
 */
internal object DiskAssets {
    private const val FONT_DIR = "assets/fonts"
    private const val FONT_STEM = "font"
    private val TYPE_BY_DIR = mapOf("assets/glyphs" to "glyph", "assets/textures" to "texture")

    private fun nameOf(path: String) = path.substringAfterLast('/').replace(Regex("\\.[^.]+$"), "")

    private fun num(value: Any?, fallback: Double?): Double? =
        (value as? Number)?.toDouble()?.takeIf { !it.isNaN() && !it.isInfinite() } ?: fallback

    fun fontFromDisk(content: String): FontMeta? = try {
        // A YAML list is an object to the editor too: a font without namespace nor glyphs.
        val parsed = when (val doc = Yaml.parse(content)) {
            is Map<*, *> -> doc
            is List<*> -> emptyMap<String, Any?>()
            else -> null
        }
        if (parsed == null) null
        else {
            val glyphs = parsed["glyphs"] as? List<*> ?: emptyList<Any?>()
            FontMeta(
                namespace = parsed["namespace"] as? String ?: "",
                glyphMap = glyphs.mapNotNull { g ->
                    val entry = g as? Map<*, *> ?: return@mapNotNull null
                    val char = entry["char"] as? String ?: return@mapNotNull null
                    val texture = entry["texture"] as? String ?: return@mapNotNull null
                    FontGlyph(char, texture, (entry["ascent"] as? Number)?.toDouble() ?: 0.0, (entry["height"] as? Number)?.toDouble() ?: 8.0)
                },
            )
        }
    } catch (_: Exception) {
        null
    }

    fun fromTree(anchorProjectId: String, files: List<PackFile>, binaries: List<String>): List<DiskAsset> {
        val descriptors = HashMap<String, Map<*, *>>()
        for (f in files) {
            val stem = if (f.path.startsWith("assets/")) YamlPaths.stem(f.path) else null
            if (stem == null || (descriptors.containsKey(stem) && !f.path.endsWith(".yml"))) continue
            when (val parsed = Yaml.parseOrNull(f.content)) {
                is Map<*, *> -> descriptors[stem] = parsed
                is List<*> -> descriptors[stem] = emptyMap<String, Any?>()
            }
        }

        val out = ArrayList<DiskAsset>()
        for (f in files) {
            val descriptor = YamlPaths.stem(f.path)
            if (!f.path.startsWith("$FONT_DIR/") || descriptor == null || !descriptor.endsWith("/$FONT_STEM")) continue
            val dir = descriptor.dropLast(FONT_STEM.length + 1)
            val name = dir.substringAfterLast('/')
            val meta = fontFromDisk(f.content) ?: continue
            out += DiskAsset(AssetRow(name, anchorProjectId, "font", name, 0.0, 0.0, null, null, null, meta), f.path)
        }
        for (path in binaries) {
            val type = TYPE_BY_DIR[path.substringBeforeLast('/', "")] ?: continue
            val meta = descriptors[path.replace(Regex("\\.[^.]+$"), "")] ?: emptyMap<String, Any?>()
            out += DiskAsset(
                AssetRow(
                    id = nameOf(path),
                    projectId = anchorProjectId,
                    type = type,
                    name = nameOf(path),
                    width = num(meta["width"], 0.0)!!,
                    height = num(meta["height"], 0.0)!!,
                    ascent = num(meta["ascent"], null),
                    codepoint = num(meta["codepoint"], null),
                    contentWidth = num(meta["content_width"], null),
                    fontMeta = meta["font_meta"],
                ),
                path,
            )
        }
        // Code unit order, as the editor sorts (not a locale's).
        return out.sortedWith { a, b -> a.path.compareTo(b.path) }
    }
}
