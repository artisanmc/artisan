package net.artisanmc.plugin.render

/**
 * Which image of the pack a name written in a module's file is (ADR `common-images-and-themes`,
 * decision 3): the module's own first, else the server's common image. The pack keeps the bare
 * name as the id of the first module that holds an image of that name, writes a later module's
 * as `<folder>:<name>` and a common image as `kit:<name>` (`ImageNames` in the pack builder,
 * `imageNames.ts` in the editor).
 *
 * Computed from the ids of the pack's asset index alone, as both builders do:
 * `testdata/image-ref-conformance.json` holds the three to one answer.
 */
object ImageRefs {
    /** A common image's id in the pack, before its name: what `kit:<name>` and `artisan:<name>` both reach. */
    private const val COMMON = "kit:"

    /** What a menu writes before a common image's name; `kit:` is the former spelling. */
    private const val ALIAS = "artisan:"

    /**
     * The id [ref] reaches when written in a file of the module [folder] (`""`: no module), among
     * the ids [has] knows: the module's own image, another module's, else the common image of
     * that name (the theme `artisan`'s) when the pack holds it.
     */
    fun resolve(has: (String) -> Boolean, folder: String, ref: String): String {
        if (ref.startsWith(COMMON)) return ref
        if (ref.startsWith(ALIAS)) return COMMON + ref.substring(ALIAS.length)
        // No id starts with a colon: a menu without a module has no image of its own. `kit:` and
        // `artisan:` name the common images, never a folder's own.
        if (folder.isNotEmpty() && "$folder:" != COMMON && "$folder:" != ALIAS && has("$folder:$ref")) return "$folder:$ref"
        if (has(ref)) return ref
        val colon = ref.indexOf(':')
        val name = if (colon < 0) ref else ref.substring(colon + 1)
        if (colon >= 0 && has(name)) return name
        return if (has(COMMON + name)) COMMON + name else name
    }
}
