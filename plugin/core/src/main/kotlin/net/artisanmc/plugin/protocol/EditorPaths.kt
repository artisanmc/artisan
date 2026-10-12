package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.ProjectPathPolicy

/** Ce que l'éditeur peut voir et écrire dans un Project. */
object EditorPaths {
    /**
     * Ce que `project_read` retire de l'arbre disque. L'éditeur a besoin de
     * `.artisan/editor.yaml` (layout du board, `i18n_mode`) — il n'a rien à
     * faire de la corbeille ni de l'état de sync.
     */
    fun isInvisible(rel: String): Boolean {
        if (ProjectPathPolicy.isPrivate(rel)) return true
        val first = rel.substringBefore('/')
        return first == ".artisan-trash" || first == ".artisan-sync.yaml" || rel == ".artisan/rename-operation.json" ||
            rel.startsWith(".artisan/history/")
    }

    /**
     * Garde de chemin pour `project_write`. Distinct de [isSafeRelPath], qui
     * refuse **tout** `.artisan*` : l'éditeur est propriétaire de
     * `.artisan/editor.yaml` et doit pouvoir l'écrire. Ce qu'il ne voit pas en
     * lecture, il ne peut pas l'écrire.
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
        if (ProjectPathPolicy.isPrivate(p)) return false
        if (p.isBlank()) return false
        val norm = p.replace('\\', '/')
        if (norm.startsWith("/") || norm.contains("..") || norm.contains(":")) return false
        return !norm.substringBefore('/').startsWith(".artisan")
    }

    /** projectId feeds ProjectRoots.dirFor — must be a bare directory name. */
    fun isSafeProjectId(id: String): Boolean =
        id.isNotBlank() && !id.contains('/') && !id.contains('\\') &&
            !id.contains("..") && !id.contains(':') && !id.startsWith(".")
}
