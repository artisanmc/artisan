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
        // `kit:<name>` and `artisan:<name>` are common images: such a folder keeps bare names.
        val id = if (name in ids && !reserved(folder)) "$folder:$name" else name
        ids += id
        mine[name] = id
        return id
    }

    /** The id of the image [ref] names in a file of the module [folder]. */
    fun resolve(folder: String, ref: String): String = resolve(ids::contains, folder, ref)

    companion object {
        /**
         * [ref] as an id, among the ids [has] knows: `kit:<name>` for `artisan:<name>` (a
         * common image, [Kit]); else the module's own image when it is not the first of that name,
         * then `<module>:<name>` when that id exists, else the name after the colon (the first
         * module's image keeps the bare id), else the common image of that name, else the name.
         *
         * The ids do not say who holds a bare one: `<module>:<name>` for an image that module
         * does not hold reaches the bare name. The asset index gains the holder with the common
         * images (step 2 of the ADR).
         */
        fun resolve(has: (String) -> Boolean, folder: String, ref: String): String {
            if (ref.startsWith(Kit.PREFIX)) return ref
            if (ref.startsWith(Kit.ALIAS)) return Kit.PREFIX + ref.substring(Kit.ALIAS.length)
            if (!reserved(folder) && has("$folder:$ref")) return "$folder:$ref"
            if (has(ref)) return ref
            val colon = ref.indexOf(':')
            val name = if (colon < 0) ref else ref.substring(colon + 1)
            if (colon >= 0 && has(name)) return name
            // No module's image: the common one of that name, when the server has it.
            return if (has(Kit.PREFIX + name)) Kit.PREFIX + name else name
        }

        /** A folder whose `<folder>:` already names the common images. */
        private fun reserved(folder: String) = "$folder:" == Kit.PREFIX || "$folder:" == Kit.ALIAS

        /** Where the files of a qualified image go in the pack (`:` cannot be in a pack's path). */
        fun path(folder: String, name: String) = "modules/$folder/$name"

        /** [row] under [id]: itself for a bare name, else with its files under the module's folder. */
        fun named(row: AssetRow, id: String, folder: String): AssetRow =
            if (id == row.id) row else row.copy(id = id, name = path(folder, row.name))
    }
}
