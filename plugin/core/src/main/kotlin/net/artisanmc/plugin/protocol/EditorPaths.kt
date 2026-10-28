package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.ProjectMetadataPaths
import net.artisanmc.plugin.project.ProjectPathPolicy

/** What the editor can see and write in a Project. */
object EditorPaths {
    /**
     * What `project_read` removes from the disk tree: every `.artisan*` metadata but
     * `.artisan/editor.yaml` (board layout, `i18n_mode`), the only one the editor owns.
     */
    fun isInvisible(rel: String): Boolean = ProjectMetadataPaths.isHiddenFromEditor(rel)

    /**
     * Path guard for `project_write`. Distinct from [isSafeRelPath], which rejects
     * **every** `.artisan*` path: the editor owns `.artisan/editor.yaml` and must be
     * able to write it. What it cannot read, it cannot write.
     */
    fun isWritable(p: String): Boolean {
        if (!ProjectPathPolicy.valid(p)) return false
        if (p.isBlank()) return false
        val norm = p.replace('\\', '/')
        if (norm.startsWith("/") || norm.contains("..") || norm.contains(":")) return false
        return !isInvisible(norm)
    }

    /** Traversal guard for relay-provided relative paths (mirror of ProjectContentReader.resolve). */
    fun isSafeRelPath(p: String): Boolean {
        if (!ProjectPathPolicy.valid(p)) return false
        if (p.isBlank()) return false
        val norm = p.replace('\\', '/')
        if (norm.startsWith("/") || norm.contains("..") || norm.contains(":")) return false
        return !ProjectMetadataPaths.isHiddenFromContent(norm)
    }

    /** projectId feeds ProjectRoots.dirFor — must be a bare directory name. */
    fun isSafeProjectId(id: String): Boolean =
        id.isNotBlank() && !id.contains('/') && !id.contains('\\') &&
            !id.contains("..") && !id.contains(':') && !id.startsWith(".")
}
