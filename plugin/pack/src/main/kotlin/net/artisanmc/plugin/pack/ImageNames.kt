package net.artisanmc.plugin.pack

/**
 * Which image a menu's name is (ADR `common-images-and-themes`, decision 3): a module's own image
 * first, another module's as `<folder>:<name>`.
 *
 * An image's id in the pack stays its bare name for the first module that holds it, by Project
 * order: a server where no two modules share a name keeps its pack byte for byte. A later
 * module's image of the same name is `<folder>:<name>`, its files under `modules/<folder>/`.
 *
 * [resolve] reads the ids alone, so the plugin finds the same image from the pack's asset index
 * (`ImageRefs` in core) and the editor from its own build (`imageNames.ts`):
 * `testdata/image-ref-conformance.json` holds the three to one answer.
 */
internal class ImageNames {
    private val ids = HashSet<String>()
    private val owned = HashMap<String, HashMap<String, String>>()

    /** An id that is no module's image (a font): an image of that name in a later module is qualified. */
    fun take(id: String) {
        ids += id
    }

    /** The id of [folder]'s image [name]: the bare name for the first module that holds one. */
    fun claim(folder: String, name: String): String {
        val mine = owned.getOrPut(folder) { HashMap() }
        mine[name]?.let { return it }
        // `kit:<name>` is the UI kit's: a module whose folder is `kit` keeps bare names.
        val id = if (name in ids && "$folder:" != Kit.PREFIX) "$folder:$name" else name
        ids += id
        mine[name] = id
        return id
    }

    /** The id of the image [ref] names in a file of the module [folder]. */
    fun resolve(folder: String, ref: String): String = resolve(ids::contains, folder, ref)

    companion object {
        /**
         * [ref] as an id, among the ids [has] knows: the module's own image when it is not the
         * first of that name, then `<module>:<name>` when that id exists, else the name after the
         * colon (the first module's image keeps the bare id), else [ref] as written.
         *
         * The ids do not say who holds a bare one: `<module>:<name>` for an image that module
         * does not hold reaches the bare name. The asset index gains the holder with the common
         * images (step 2 of the ADR).
         */
        fun resolve(has: (String) -> Boolean, folder: String, ref: String): String {
            if (ref.startsWith(Kit.PREFIX)) return ref
            val own = "$folder:$ref"
            // In a module whose folder is `kit`, `kit:<name>` stays the UI kit's.
            if (!own.startsWith(Kit.PREFIX) && has(own)) return own
            val colon = ref.indexOf(':')
            return if (colon < 0 || has(ref)) ref else ref.substring(colon + 1)
        }

        /** Where the files of a qualified image go in the pack (`:` cannot be in a pack's path). */
        fun path(folder: String, name: String) = "modules/$folder/$name"

        /** [row] under [id]: itself for a bare name, else with its files under the module's folder. */
        fun named(row: AssetRow, id: String, folder: String): AssetRow =
            if (id == row.id) row else row.copy(id = id, name = path(folder, row.name))
    }
}
