package net.artisanmc.plugin.tree

import net.artisanmc.plugin.project.EditorYaml
import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.DocumentLayout
import net.artisanmc.plugin.model.ManifestYaml
import net.artisanmc.plugin.model.ModuleFile
import net.artisanmc.plugin.model.Originals
import net.artisanmc.plugin.model.YamlFiles
import net.artisanmc.plugin.yaml.LangFlattener
import net.artisanmc.plugin.yamlio.Yaml12

/**
 * A folder's tree in the former layout (design `originaux-modules`: `originals/` under the
 * owner's files) to the same content as one tree the owner edits (ADR `editable-module-tree`,
 * "Migration"). Pure: paths to bytes in, paths to bytes out, `originals/` gone.
 *
 * Kept for good: it migrates a folder at start, and turns a Version or a draft made before the
 * migration into the layout of today before it is restored or published.
 *
 * The rules are those of the readers of the former layout, each kind by its own:
 * 1. Documents (`DocumentLayout.classify`): the owner's of the same (variant, kind folder, id)
 *    wins, wherever it sits; an excluded optional original is left out; **an excluded required
 *    one is copied** (its exclusion was ignored).
 * 2. `variants.yml`: the owner's if any, else the module's.
 * 3. `lang/<code>.yml`: the module's messages with the owner's keys over them, in one file.
 * 4. `data/` and `models/`: a top-level file by stem, the owner's first; a per-row folder
 *    (`data/<id>/`) is the owner's whole when they have one.
 * 5. Assets: path by path, the owner's first (exclusions never reached the pack); a shipped PNG
 *    whose name the owner's composed image takes (`compose:` in the owner's descriptor) is left
 *    out.
 * 6. Anything else: path by path, the owner's first.
 * `originals/originals.yml` goes: what it said lives in [ShippedIndex] now.
 */
object FlattenOriginals {
    private val yaml = ObjectMapper(Yaml12.factory()).registerKotlinModule()
    private const val PREFIX = "${Originals.DIR}/"
    private val RESOURCE_TABLES = setOf("data", "models")

    /** Whether [paths] still hold the former layout. */
    fun needed(paths: Collection<String>): Boolean = paths.any { it.startsWith(PREFIX) }

    /**
     * [files] (path → bytes, the whole folder's content, metadata `.artisan*` excluded or not:
     * it is passed through) flattened. [kindDirs]: the Document kinds' folders.
     */
    fun flatten(files: Map<String, ByteArray>, kindDirs: Set<String>): Map<String, ByteArray> {
        if (!needed(files.keys)) return files
        val own = files.filterKeys { !it.startsWith(PREFIX) }
        val shipped = files.filterKeys { it.startsWith(PREFIX) && it != Originals.INDEX_PATH }
            .mapKeys { it.key.removePrefix(PREFIX) }
        val out = LinkedHashMap(own)

        val manifest = ModuleFile.NAMES.firstNotNullOfOrNull { own[it] }
            ?.let { runCatching { yaml.readValue(it, ManifestYaml::class.java) }.getOrNull() }
        val index = Originals.parseIndex(files[Originals.INDEX_PATH]?.toString(Charsets.UTF_8))
        val excluded = Originals.exclusions(manifest, index).excluded.mapTo(HashSet(), DocumentLayout::sameFile)
        val ownSame = own.keys.mapTo(HashSet(), DocumentLayout::sameFile)
        val handled = HashSet<String>()

        // 1. Documents, by identity.
        val layout = DocumentLayout.classify(files.keys, kindDirs, excluded)
        val originalDocs = (layout.documents + layout.variants).filter { it.original }
        for (doc in originalDocs) {
            val at = doc.path.removePrefix(PREFIX)
            out[at] = shipped.getValue(at)
        }
        // Every shipped Document file is decided by the layout, copied above or not.
        val shippedDocs = DocumentLayout.classify(shipped.keys, kindDirs).let { r ->
            (r.documents + r.variants).map { it.path } + r.errors.map { it.path }
        }
        handled += shippedDocs
        // A required file excluded by the owner: its exclusion was ignored, the original loaded.
        // `classify` above already left it in (exclusions hold optional files only).

        // 2. The variants' rules.
        val variantsShipped = shipped.keys.filter { !it.contains('/') && YamlFiles.stem(it) == DocumentLayout.VARIANTS_FILE }
        handled += variantsShipped
        val ownVariants = own.keys.any { !it.contains('/') && YamlFiles.stem(it) == DocumentLayout.VARIANTS_FILE }
        if (!ownVariants) variantsShipped.minOrNull()?.let { out[it] = shipped.getValue(it) }

        // 3. Messages, key by key.
        for (path in shipped.keys.filter { isTopLevel(it, "lang") && YamlFiles.isYaml(it) }) {
            handled += path
            if (DocumentLayout.sameFile(path) in excluded) continue
            val ownPath = own.keys.firstOrNull { DocumentLayout.sameFile(it) == DocumentLayout.sameFile(path) }
            if (ownPath == null) {
                out[path] = shipped.getValue(path)
                continue
            }
            out[ownPath] = mergeLang(shipped.getValue(path), own.getValue(ownPath))
        }

        // 4. Data and models.
        for (path in shipped.keys.filter { p -> RESOURCE_TABLES.any { isTopLevel(p, it) } && YamlFiles.isYaml(p) }) {
            handled += path
            if (DocumentLayout.sameFile(path) in excluded || DocumentLayout.sameFile(path) in ownSame) continue
            out[path] = shipped.getValue(path)
        }
        val ownRowDirs = own.keys.mapNotNull { rowDir(it) }.toSet()
        for (path in shipped.keys.filter { rowDir(it) != null }) {
            handled += path
            val dir = rowDir(path)!!
            if (dir in ownRowDirs || dir in excluded) continue
            out[path] = shipped.getValue(path)
        }

        // 5. Assets: the owner's composed image takes the name of a shipped PNG.
        val composedOver = own.filter { (p, bytes) -> p.startsWith("assets/") && YamlFiles.isYaml(p) && composes(bytes) }
            .keys.mapNotNull(YamlFiles::stem).toSet()
        for (path in shipped.keys.filter { it.startsWith("assets/") }) {
            handled += path
            if (DocumentLayout.sameFile(path) in ownSame) continue
            if (!YamlFiles.isYaml(path) && path.substringBeforeLast('.', path) in composedOver) continue
            out[path] = shipped.getValue(path)
        }

        // 6. The rest, path by path.
        for ((path, bytes) in shipped) {
            if (path in handled || DocumentLayout.sameFile(path) in ownSame) continue
            out[path] = bytes
        }
        return out
    }

    /** `lang/fr.yml` is top-level in `lang`; `lang/sub/fr.yml` is not. */
    private fun isTopLevel(path: String, dir: String) = path.startsWith("$dir/") && path.count { it == '/' } == 1

    /** `data/<id>` for a file of a per-row folder (`data/<id>/<row>.yml`), else null. */
    private fun rowDir(path: String): String? {
        val segs = path.split('/')
        return if (segs.size >= 3 && segs[0] == "data") "data/${segs[1]}" else null
    }

    private fun composes(bytes: ByteArray): Boolean {
        val doc = runCatching { yaml.readValue(bytes, Map::class.java) }.getOrNull() ?: return false
        return (doc["compose"] as? List<*>)?.isNotEmpty() == true
    }

    /**
     * The module's messages with the owner's over them, key for key, as the former reader
     * merged them. Nested like the files when the trees merge cleanly, flat keys otherwise.
     */
    internal fun mergeLang(shipped: ByteArray, own: ByteArray): ByteArray {
        val type = object : TypeReference<Map<String, Any?>>() {}
        val s = runCatching { yaml.readValue(shipped, type) }.getOrNull() ?: return own
        val o = runCatching { yaml.readValue(own, type) }.getOrNull() ?: return own
        val expected = LangFlattener.flatten(s) + LangFlattener.flatten(o)
        val deep = deepMerge(s, o)
        val tree = if (LangFlattener.flatten(deep) == expected) deep else expected
        return EditorYaml.write(tree).toByteArray(Charsets.UTF_8)
    }

    @Suppress("UNCHECKED_CAST")
    private fun deepMerge(base: Map<String, Any?>, over: Map<String, Any?>): Map<String, Any?> {
        val out = LinkedHashMap(base)
        for ((k, v) in over) {
            val b = out[k]
            out[k] = if (b is Map<*, *> && v is Map<*, *>) deepMerge(b as Map<String, Any?>, v as Map<String, Any?>) else v
        }
        return out
    }
}
