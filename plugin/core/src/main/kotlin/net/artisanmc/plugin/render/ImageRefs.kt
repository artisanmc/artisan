package net.artisanmc.plugin.render

/**
 * Which image of the pack a name written in a module's file is (ADR `common-images-and-themes`,
 * decision 3): the module's own first. The pack keeps the bare name as the id of the first
 * module that holds an image of that name and writes a later module's as `<folder>:<name>`
 * (`ImageNames` in the pack builder, `imageNames.ts` in the editor).
 *
 * Computed from the ids of the pack's asset index alone, as both builders do:
 * `testdata/image-ref-conformance.json` holds the three to one answer.
 */
object ImageRefs {
    /** `kit:<name>` is an image of the UI kit, in any module. */
    private const val KIT = "kit:"

    /** The id [ref] reaches when written in a file of the module [folder] (`""`: no module), among the ids [has] knows. */
    fun resolve(has: (String) -> Boolean, folder: String, ref: String): String {
        if (ref.startsWith(KIT)) return ref
        val own = "$folder:$ref"
        // No id starts with a colon: a menu without a module has no image of its own.
        if (folder.isNotEmpty() && !own.startsWith(KIT) && has(own)) return own
        val colon = ref.indexOf(':')
        return if (colon < 0 || has(ref)) ref else ref.substring(colon + 1)
    }
}
