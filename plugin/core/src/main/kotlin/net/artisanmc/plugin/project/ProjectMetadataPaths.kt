package net.artisanmc.plugin.project

/**
 * The `.artisan*` metadata rule of a Project (docs/architecture/invariants.md,
 * « Exclusion `.artisan*` universelle »), in one place.
 *
 * A path relative to the Project's folder whose **first segment** starts with
 * `.artisan` is metadata: out of the hash, invisible to the content scan, out of
 * every content channel. Case is ignored, because the disk may not respect it
 * (macOS, a Docker bind mount from Windows): `.ARTISAN/project-id` is the
 * Project's identity file there. A `.artisan` folder deeper in the tree
 * (`data/.artisan/x`) is ordinary content.
 *
 * The private state ([ProjectPathPolicy.isPrivate]: drafts, transactions,
 * temporary writes) is a separate, stricter rule, matched at any depth.
 */
object ProjectMetadataPaths {
    private const val PREFIX = ".artisan"

    /** The one metadata file the editor owns (board layout, `i18n_mode`), canonical spelling only. */
    const val EDITOR_FILE = ".artisan/editor.yaml"

    private fun normalized(rel: String) = rel.replace('\\', '/')

    /** First segment starts with `.artisan`, any case. */
    fun isMeta(rel: String): Boolean =
        normalized(rel).substringBefore('/').startsWith(PREFIX, ignoreCase = true)

    /** [EDITOR_FILE], the only metadata the editor reads and writes. */
    fun isEditorOwned(rel: String): Boolean = normalized(rel) == EDITOR_FILE

    /** `.artisan/history/…`, archives too large for the text walk; read by `project_history` only. */
    fun isHistory(rel: String): Boolean = normalized(rel).startsWith("$PREFIX/history/", ignoreCase = true)

    /**
     * What the editor can neither read nor write (`project_read` / `project_write`):
     * private state, and every metadata path but [EDITOR_FILE]. Symmetric on
     * purpose: what the editor does not see, it cannot write.
     */
    fun isHiddenFromEditor(rel: String): Boolean =
        ProjectPathPolicy.isPrivate(rel) || (isMeta(rel) && !isEditorOwned(rel))

    /** What no content channel (module reads, relay writes) may touch: private state and all metadata. */
    fun isHiddenFromContent(rel: String): Boolean = ProjectPathPolicy.isPrivate(rel) || isMeta(rel)
}
