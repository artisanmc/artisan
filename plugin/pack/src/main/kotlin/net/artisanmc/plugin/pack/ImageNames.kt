package net.artisanmc.plugin.pack

/**
 * Which image a menu's name is (ADR `common-images-and-themes`, decision 3): a module's own image
 * first, then the server's common image of that name, then another module's.
 *
 * An image's id in the pack stays its bare name for the first module that holds it, by Project
 * order, when no common image has that name: a server where no two modules share a name, and
 * none takes a common image's, keeps its pack byte for byte. Any other module's image is
 * `<folder>:<name>`, its files under `modules/<folder>/`. So a bare id is never an image whose
 * name a common image has, and a name alone reaches the common one before another module's.
 *
 * [resolve] reads the ids alone, so the plugin finds the same image from the pack's asset index
 * (`ImageRefs` in core) and the editor from its own build (`imageNames.ts`):
 * `testdata/image-ref-conformance.json` holds the three to one answer.
 */
internal class ImageNames {
    private val ids = HashSet<String>()
    private val owned = HashMap<String, HashMap<String, String>>()
    private val commons = HashSet<String>()

    /** An id that is no module's image (a font): an image of that name in a later module is qualified. */
    fun take(id: String) {
        ids += id
    }

    /**
     * A common image's name ([Kit]), told before any module's image is named: a module's image
     * of that name is qualified, so the bare name stays the common image's for the other modules.
     */
    fun common(name: String) {
        commons += name
        ids += Kit.PREFIX + name
    }

    /** The id of [folder]'s image [name]: the bare name for the first module that holds one no common image has. */
    fun claim(folder: String, name: String): String {
        val mine = owned.getOrPut(folder) { HashMap() }
        mine[name]?.let { return it }
        // `kit:<name>` and `artisan:<name>` are common images: such a folder keeps bare names.
        val id = if ((name in ids || name in commons) && !reserved(folder)) "$folder:$name" else name
        ids += id
        mine[name] = id
        return id
    }

    /**
     * A theme's own image [name] (`themes/<theme>/assets/`, ADR `common-images-and-themes`,
     * decision 5), told once every module's image is named: its id is `<theme>:<name>`, never
     * the bare name. Null when that id is taken already. The caller leaves out a theme of a
     * module's name: `<folder>:<name>` is that module's, whatever it holds.
     */
    fun themeOwn(theme: String, name: String): String? {
        val id = "$theme:$name"
        if (id in ids || reserved(theme)) return null
        ids += id
        return id
    }

    /** The id of the image [ref] names in a file of the module [folder]. */
    fun resolve(folder: String, ref: String): String = resolve(ids::contains, folder, ref)

    companion object {
        /**
         * [ref] as an id, among the ids [has] knows: `kit:<name>` for `artisan:<name>` (a
         * common image, [Kit]); else the module's own image under its qualified id, then the bare
         * id (the module's own or another's, never one a common image shares its name with),
         * then `<module>:<name>` when that id exists, else the name after the colon, else the
         * common image of that name, else the name.
         *
         * The ids do not say who holds a bare one: `<module>:<name>` for an image that module
         * does not hold reaches the bare name, then the common image.
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

        /** Where the files of a theme's own image go in the pack. */
        fun themePath(theme: String, name: String) = "themes/$theme/$name"

        /** [row] under [id]: itself for a bare name, else with its files under the module's folder. */
        fun named(row: AssetRow, id: String, folder: String): AssetRow =
            if (id == row.id) row else row.copy(id = id, name = path(folder, row.name))
    }
}
