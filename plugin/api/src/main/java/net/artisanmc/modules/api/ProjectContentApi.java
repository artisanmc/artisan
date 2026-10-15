package net.artisanmc.modules.api;

import java.util.List;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * Read-only view of the project content on disk for modules ({@code api.project}). Backed by
 * {@code plugins/Artisan/projects/} and the registered add-on roots. Paths use '/' separators.
 * The {@code .artisan*} namespace (editor metadata, trash) is never exposed. Content refreshes
 * on reload: modules should re-read in {@link ArtisanModule#onReload}.
 */
@Stable
public interface ProjectContentApi {
    /** Ids of projects present on disk (hidden directories excluded). */
    @Stable
    List<String> projectIds();

    /** Relative file paths under {@code <projectId>/<dir>}, sorted. Empty if absent. */
    @Stable
    List<String> list(String projectId, String dir);

    /** UTF-8 content of a project file, or null if absent / outside the project root. */
    @Stable
    @Nullable String read(String projectId, String relPath);

    /** True if at least one project has a non-empty {@code <dir>/} folder (bootstrap check). */
    @Stable
    boolean hasContent(String dir);

    /**
     * Re-reads the projects from disk, then notifies modules: the same path as {@code /artisan reload}.
     * Call it right after your module writes its OWN project files: the core serves a snapshot taken
     * at load, so an unannounced write stays invisible to the running server and to the editor.
     */
    @Stable
    default void reload() {}
}
