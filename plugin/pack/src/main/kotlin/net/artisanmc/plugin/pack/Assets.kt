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

/**
 * [recipe]: a composed image ([ComposedImages]), whose [path] is its descriptor's: it has no PNG.
 * [ramps]: the image says it follows the ramps (`ramps: true` in its descriptor), so a theme's
 * colours repaint it ([KitTheme]); a composed image follows its layers instead.
 */
internal class DiskAsset(val row: AssetRow, val path: String, val recipe: ComposedImages.Recipe? = null, val ramps: Boolean = false)

internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

internal fun sha1Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }

/** `.yml` then `.yaml`, as the plugin's `YamlFiles` and the editor's `yamlFiles.ts`. */
/**
 * Each entry at the path it takes in the module's folder (design `originaux-modules`): the owner's
 * where they are, a shipped one (`originals/…`) at its path without the prefix unless the owner has
 * that file (`x.yml` and `x.yaml` name the same one). The owner's first, each in input order
 * (`shippedView.ts`).
 */
internal object ShippedView {
    private const val PREFIX = "originals/"

    fun <T> of(entries: List<T>, pathOf: (T) -> String): List<Pair<T, String>> {
        fun same(path: String) = YamlPaths.stem(path) ?: path
        val own = entries.filter { !pathOf(it).startsWith(PREFIX) }
        val taken = own.mapTo(HashSet()) { same(pathOf(it)) }
        val out = own.mapTo(ArrayList()) { it to pathOf(it) }
        for (entry in entries) {
            val path = pathOf(entry)
            if (!path.startsWith(PREFIX)) continue
            val at = path.removePrefix(PREFIX)
            if (same(at) !in taken) out += entry to at
        }
        return out
    }
}

internal object YamlPaths {
    private val EXTENSIONS = listOf(".yml", ".yaml")

    fun isYaml(path: String) = EXTENSIONS.any { path.endsWith(it) }

    fun stem(path: String): String? = EXTENSIONS.firstOrNull { path.endsWith(it) }?.let { path.dropLast(it.length) }
}

/**
 * What an image is for, declared in its descriptor (`function: menu | glyph | hud`, ADR
 * `common-images-and-themes`, decision 4): the function fixes the image's measures, its pixel
 * size for a menu or HUD image, its height and ascent for a glyph. The owner's image of the
 * name of one the module ships (`originals/…`) with a function is taken only at the original's
 * measures; otherwise the original shows, descriptor included (`imageFunction.ts`). The common
 * images' base has the same rule from its own list ([Kit.image]).
 */
internal object ImageFunctions {
    private const val ORIGINALS = "originals/"
    private val FUNCTIONS = setOf("menu", "glyph", "hud")
    private val IMAGE_DIRS = setOf("assets/glyphs", "assets/textures")

    /** An owner's image standing over an original that declares a function. */
    class Over(val path: String, val stem: String, val original: String, val function: String, val originalMeta: Map<*, *>, val meta: Map<*, *>)

    fun of(meta: Map<*, *>?): String? = (meta?.get("function") as? String)?.takeIf { it in FUNCTIONS }

    /** Whether a descriptor says its image follows the ramps: `ramps: true`, nothing else. */
    fun ramps(meta: Map<*, *>?): Boolean = meta?.get("ramps") == true

    /** The pixel size of a PNG, as the pack measures it; null for no file or one that is no image. */
    fun pixelSize(png: ByteArray?): Pair<Int, Int>? = png?.let { bytes -> runCatching { Png.decode(bytes) }.getOrNull()?.let { it.width to it.height } }

    /** The descriptors among [files], by stem, as [DiskAssets.fromTree] reads them (`.yml` wins). */
    private fun descriptors(files: List<PackFile>): Map<String, Map<*, *>> {
        val out = HashMap<String, Map<*, *>>()
        for (f in files) {
            val stem = if (f.path.startsWith("assets/")) YamlPaths.stem(f.path) else null
            if (stem == null || (out.containsKey(stem) && !f.path.endsWith(".yml"))) continue
            when (val parsed = Yaml.parseOrNull(f.content)) {
                is Map<*, *> -> out[stem] = parsed
                is List<*> -> out[stem] = emptyMap<String, Any?>()
                else -> {}
            }
        }
        return out
    }

    private fun num(value: Any?, fallback: Double?): Double? =
        (value as? Number)?.toDouble()?.takeIf { !it.isNaN() && !it.isInfinite() } ?: fallback

    fun over(files: List<PackFile>, binaries: List<String>): List<Over> {
        val shipped = binaries.filterTo(HashSet()) { it.startsWith(ORIGINALS) }
        if (shipped.isEmpty()) return emptyList()
        val originalMeta = descriptors(files.filter { it.path.startsWith(ORIGINALS) }.map { PackFile(it.path.removePrefix(ORIGINALS), it.content) })
        val ownMeta = descriptors(files.filter { !it.path.startsWith(ORIGINALS) })
        val out = ArrayList<Over>()
        for (path in binaries) {
            if (path.startsWith(ORIGINALS) || path.substringBeforeLast('/', "") !in IMAGE_DIRS) continue
            val original = "$ORIGINALS$path"
            if (original !in shipped) continue
            val stem = path.replace(Regex("\\.[^.]+$"), "")
            val shippedMeta = originalMeta[stem] ?: continue
            val function = of(shippedMeta) ?: continue
            out += Over(path, stem, original, function, shippedMeta, ownMeta[stem] ?: shippedMeta)
        }
        return out
    }

    /**
     * The owner's images that are not taken. A glyph is measured by its descriptor (height and
     * ascent); a menu or HUD image by its pixels, through [sizeOf] (null for a file that is no
     * image): without [sizeOf] it is taken, and so is one whose original cannot be measured.
     */
    fun refused(files: List<PackFile>, binaries: List<String>, sizeOf: ((String) -> Pair<Int, Int>?)?): List<Over> =
        over(files, binaries).filter { image ->
            if (image.function == "glyph") {
                num(image.meta["height"], 0.0) != num(image.originalMeta["height"], 0.0) ||
                    num(image.meta["ascent"], null) != num(image.originalMeta["ascent"], null)
            } else if (sizeOf == null) {
                false
            } else {
                val original = sizeOf(image.original)
                original != null && sizeOf(image.path) != original
            }
        }
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

    /**
     * [originals]: the pack's read, the module's assets (`originals/assets/…`) too, the owner's file
     * winning name for name ([ShippedView]). A returned path stays the file's real one, to read its bytes.
     * [sizeOf]: the pixel size of a file, for the pack ([ImageFunctions.refused]).
     */
    fun fromTree(
        anchorProjectId: String,
        ownFiles: List<PackFile>,
        ownBinaries: List<String>,
        originals: Boolean = false,
        sizeOf: ((String) -> Pair<Int, Int>?)? = null,
    ): List<DiskAsset> {
        // The owner's images that are not taken go, descriptor included: the original's show ([ImageFunctions]).
        val refused = if (originals) ImageFunctions.refused(ownFiles, ownBinaries, sizeOf) else emptyList()
        val leftOut = refused.mapTo(HashSet()) { it.path }
        val leftOutStems = refused.mapTo(HashSet()) { it.stem }
        val keptFiles = if (leftOut.isEmpty()) ownFiles else ownFiles.filter { f ->
            val stem = if (f.path.startsWith("originals/")) null else YamlPaths.stem(f.path)
            stem == null || stem !in leftOutStems
        }
        val keptBinaries = if (leftOut.isEmpty()) ownBinaries else ownBinaries.filter { it !in leftOut }
        // (path in the module's folder, real path)
        val files = if (originals) ShippedView.of(keptFiles) { it.path }.map { (f, at) -> PackFile(at, f.content) to f.path }
        else keptFiles.map { it to it.path }
        val binaries = if (originals) ShippedView.of(keptBinaries) { it }.map { (real, at) -> at to real }
        else keptBinaries.map { it to it }
        val descriptors = HashMap<String, Map<*, *>>()
        val descriptorPaths = HashMap<String, String>()
        for ((f, real) in files) {
            val stem = if (f.path.startsWith("assets/")) YamlPaths.stem(f.path) else null
            if (stem == null || (descriptors.containsKey(stem) && !f.path.endsWith(".yml"))) continue
            when (val parsed = Yaml.parseOrNull(f.content)) {
                is Map<*, *> -> descriptors[stem] = parsed
                is List<*> -> descriptors[stem] = emptyMap<String, Any?>()
                else -> continue
            }
            descriptorPaths[stem] = real
        }

        val out = ArrayList<DiskAsset>()
        for ((f, real) in files) {
            val descriptor = YamlPaths.stem(f.path)
            if (!f.path.startsWith("$FONT_DIR/") || descriptor == null || !descriptor.endsWith("/$FONT_STEM")) continue
            val dir = descriptor.dropLast(FONT_STEM.length + 1)
            val name = dir.substringAfterLast('/')
            val meta = fontFromDisk(f.content) ?: continue
            out += DiskAsset(AssetRow(name, anchorProjectId, "font", name, 0.0, 0.0, null, null, null, meta), real)
        }
        for ((path, real) in binaries) {
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
                real,
                ramps = ImageFunctions.ramps(meta),
            )
        }
        // A composed image: a descriptor with a recipe and no file of its name beside it.
        val drawn = binaries.mapTo(HashSet()) { (path, _) -> path.replace(Regex("\\.[^.]+$"), "") }
        for ((stem, meta) in descriptors) {
            val type = TYPE_BY_DIR[stem.substringBeforeLast('/', "")] ?: continue
            if (stem in drawn) continue
            val recipe = ComposedImages.recipe(meta) ?: continue
            val name = stem.substringAfterLast('/')
            out += DiskAsset(
                AssetRow(
                    id = name,
                    projectId = anchorProjectId,
                    type = type,
                    name = name,
                    width = num(meta["width"], 0.0)!!,
                    height = num(meta["height"], 0.0)!!,
                    ascent = num(meta["ascent"], null),
                    codepoint = num(meta["codepoint"], null),
                    contentWidth = num(meta["content_width"], null),
                    fontMeta = meta["font_meta"],
                ),
                descriptorPaths.getValue(stem),
                recipe,
            )
        }
        // Code unit order, as the editor sorts (not a locale's).
        return out.sortedWith { a, b -> a.path.compareTo(b.path) }
    }
}
