package net.artisanmc.plugin.model

/**
 * Where a module's Documents live on disk: `<folders…>/<kind dir>/<id>.yml` (or `.yaml`,
 * [YamlFiles]; the same id under both is a `duplicate_id`).
 *
 * Zero to [MAX_DEPTH] themed folders group Documents of any kind; under each,
 * the kind folders (`menus/`, `commands/`, a module's `quest_groups/`) hold
 * files only, exactly as at the module root. The id is the file name: moving a
 * Document between folders changes no reference, no `lang/` key, no board key.
 * One id per kind across the whole module.
 *
 * **Variants** (design `variantes-modules`): when the module root holds [VARIANTS_FILE]
 * (`variants.yml` or `.yaml`), `variants/<name>/…` is no themed folder: each `<name>` is a
 * variant whose files follow the same layout, and its Documents land in [Result.variants], ids
 * unique per kind inside the variant (the same id as a Document of the module is the point).
 * Without that file nothing changes, even for a themed folder named `variants`.
 *
 * Pure function of the paths, so the plugin and the editor (`domain/documentLayout.ts`)
 * agree byte for byte — locked by `testdata/document-layout-conformance.json`.
 */
object DocumentLayout {
    /** Module-root folders that are never themed folders: resources, overrides, config. */
    val RESOURCE_DIRS = setOf("lang", "items", "data", "models", "templates", "assets", "overrides", "config")

    const val MAX_DEPTH = 3

    /** The module-root file that turns `variants/` into the variants' folder (`variants.yml` or `.yaml`). */
    const val VARIANTS_FILE = "variants"

    /** The folder of the variants, at the module root. */
    const val VARIANTS_DIR = "variants"

    private val FOLDER = Regex("^[a-z0-9][a-z0-9_-]*$")

    /**
     * A Document found on disk. [folder] is the themed path, `""` at the module root (inside its
     * variant for a variant's Document). [variant] is `""` for the module's own Documents.
     */
    data class Entry(val path: String, val dir: String, val id: String, val folder: String, val variant: String = "")

    /** A file shaped like a Document that is refused, with a stable [reason] code. */
    data class Error(val path: String, val reason: String)

    data class Result(val documents: List<Entry>, val errors: List<Error>, val variants: List<Entry> = emptyList())

    /** Whether [paths] hold the module-root file that declares variants. */
    fun hasVariants(paths: Collection<String>): Boolean =
        paths.any { !it.contains('/') && YamlFiles.stem(it) == VARIANTS_FILE }

    /**
     * Classifies [paths] (relative to the module folder, `/`-separated) against the
     * registered [kindDirs]. Paths that are not Documents at all (resources,
     * metadata, loose files, unregistered kind folders) appear in neither list.
     */
    fun classify(paths: Collection<String>, kindDirs: Set<String>): Result {
        val variantsOn = hasVariants(paths)
        val candidates = mutableListOf<Entry>()
        val errors = mutableListOf<Error>()
        for (path in paths.sorted()) {
            val r = if (variantsOn && path.startsWith("$VARIANTS_DIR/")) classifyVariant(path, kindDirs)
            else classifyOne(path, kindDirs)
            when (r) {
                is Entry -> candidates += r
                is Error -> errors += r
            }
        }
        val duplicated = candidates.groupBy { Triple(it.variant, it.dir, it.id) }.filterValues { it.size > 1 }.values.flatten().toSet()
        errors += duplicated.map { Error(it.path, "duplicate_id") }
        val kept = candidates - duplicated
        return Result(kept.filter { it.variant.isEmpty() }, errors.sortedBy { it.path }, kept.filter { it.variant.isNotEmpty() })
    }

    /** `variants/<name>/<rest>`: [rest] classified like a module path, under the variant [name]. */
    private fun classifyVariant(path: String, kindDirs: Set<String>): Any? {
        val segs = path.split('/')
        if (segs.size < 3) return null
        val name = segs[1]
        val rest = segs.drop(2).joinToString("/")
        return when (val r = classifyOne(rest, kindDirs)) {
            is Entry -> if (!FOLDER.matches(name)) Error(path, "invalid_variant") else r.copy(path = path, variant = name)
            is Error -> Error(path, r.reason)
            else -> null
        }
    }

    private fun classifyOne(path: String, kindDirs: Set<String>): Any? {
        val segs = path.split('/')
        if (segs.any { it.isEmpty() || it.startsWith('.') }) return null
        val file = segs.last()
        val id = YamlFiles.stem(file) ?: return null
        val dirs = segs.dropLast(1)
        if (dirs.isEmpty() || dirs.first() in RESOURCE_DIRS) return null
        val kindAt = dirs.indexOfFirst { it in kindDirs }
        if (kindAt < 0) return null
        if (kindAt != dirs.lastIndex) return Error(path, "kind_dir_subfolder")
        val folders = dirs.subList(0, kindAt)
        for (f in folders) {
            if (f in RESOURCE_DIRS) return Error(path, "reserved_folder")
            if (!FOLDER.matches(f)) return Error(path, "invalid_folder")
        }
        if (folders.size > MAX_DEPTH) return Error(path, "too_deep")
        return Entry(path, dirs[kindAt], id, folders.joinToString("/"))
    }
}
