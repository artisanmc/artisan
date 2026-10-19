package net.artisanmc.modules.api.project;

import java.io.File;
import net.artisanmc.modules.api.ArtisanModule;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Stable;

/**
 * Lets an add-on host its Project in its <b>own plugin dir</b> instead of the core
 * {@code plugins/Artisan/modules/} ({@code api.projectRoots}, ADR {@code addon-owned-project-roots}).
 * Call {@link #register} once from {@code onEnable(api)}.
 */
@Stable
public interface ProjectRootRegistry {
    /** No-op registry (tests / default). */
    ProjectRootRegistry NOOP = (projectId, dir) -> {};

    /**
     * Registers that {@code projectId}'s working copy lives at {@code dir}, a <b>dedicated</b>
     * directory the add-on owns. Do NOT pass the plugin's data-folder root: the core treats every
     * file under a project dir as project content (read, hashed, shown and edited in the editor),
     * so the dir must hold nothing but that project's files.
     *
     * <p>The core then reads, hashes, publishes, trashes and hot-reloads that project from
     * {@code dir} (its {@code .artisan-trash/} sits beside it). On a projectId collision with a
     * core-scanned project, the registered dir wins. The projects are reloaded on the next server
     * tick, once the caller's {@code onEnable} has returned: bootstrap content written after this
     * call is picked up, and modules' {@code onReload()} runs then.
     */
    @Stable
    void register(String projectId, File dir);

    /**
     * Same as {@link #register(String, File)}, naming the module ({@link ArtisanModule#getId()})
     * that owns the project: the editor then lists it under that module even when the module
     * declares no config screen. Prefer this form.
     */
    @Stable
    default void register(String projectId, File dir, String moduleId) {
        register(projectId, dir);
    }

    /**
     * Same as {@link #register(String, File, String)}, for a root that holds the module's
     * <b>configuration</b> (a singleton edited by its config screens, such as a rewards table),
     * not content: the editor lists it under the module, not among the server's Projects. It is
     * read, published and versioned like any Project. Since 2.7.0.
     */
    @Beta
    default void registerConfig(String projectId, File dir, String moduleId) {
        register(projectId, dir, moduleId);
    }
}
