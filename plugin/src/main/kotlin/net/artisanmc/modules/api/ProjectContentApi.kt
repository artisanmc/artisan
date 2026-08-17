package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable

/**
 * Read-only view of the project content on disk for modules. Backed by
 * `plugins/Artisan/projects/`. Paths use '/' separators. The `.artisan*`
 * namespace (sync metadata, trash) is never exposed. Content refreshes on
 * bundle sync — modules should re-read in [ArtisanModule.onReload].
 */
@Stable
interface ProjectContentApi {
    /** Ids of projects present on disk (hidden directories excluded). */
    @Stable fun projectIds(): List<String>

    /** Relative file paths under `<projectId>/<dir>`, sorted. Empty if absent. */
    @Stable fun list(projectId: String, dir: String): List<String>

    /** UTF-8 content of a project file, or null if absent / outside the project root. */
    @Stable fun read(projectId: String, relPath: String): String?

    /** True if at least one project has a non-empty `<dir>/` folder (bootstrap check). */
    @Stable fun hasContent(dir: String): Boolean

    /**
     * Re-read the projects from disk, then notify modules — the same path as
     * `/artisan reload`.
     *
     * Call it right after your module writes its OWN project files. The core
     * serves a snapshot taken at load (reload semantics), so an unannounced
     * write stays invisible to the running server AND to the editor until a
     * human types `/artisan reload`. You are the one who knows you wrote.
     */
    @Stable fun reload() {}
}
