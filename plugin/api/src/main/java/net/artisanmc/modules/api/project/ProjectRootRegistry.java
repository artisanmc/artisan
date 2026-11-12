package net.artisanmc.modules.api.project;

import java.io.File;
import net.artisanmc.modules.api.ArtisanModule;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.annotations.Sunset;
import org.jetbrains.annotations.Nullable;

/**
 * Lets an add-on host its Project in its <b>own plugin dir</b> instead of the core
 * {@code plugins/Artisan/modules/} ({@code api.projectRoots}, ADR {@code addon-owned-project-roots}).
 * Call {@link #pluginFolder} once from {@code onEnable(api)}: the add-on's files then live in its
 * plugin's folder, so deleting that folder uninstalls it and copying it moves it to another server.
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
     * read, published and versioned like any Project.
     */
    @Beta
    default void registerConfig(String projectId, File dir, String moduleId) {
        register(projectId, dir, moduleId);
    }

    /**
     * The module's own folder, {@code plugins/Artisan/modules/<folder>/}, created if missing and
     * registered like a {@link #register} root under {@code moduleId}: published and versioned like
     * any project, listed under the module in the editor, never renamed or deleted from it. Read and
     * write the module's files in the returned directory. Call it in {@code onEnable}, before
     * writing any default file.
     *
     * <p>{@code legacyDir}, the root the module registered before, moves there once, when the
     * folder does not exist yet. Pass as {@code folder} the project id it was registered under:
     * its Versions and drafts follow, and qualified references ({@code <folder>:<id>}) keep
     * resolving. While both directories hold files, or when the move fails, {@code legacyDir}
     * stays registered as before and is returned, with an error in the log.
     *
     * @param folder lowercase letters, digits, {@code _} and {@code -}
     * @param legacyDir the former root, or {@code null} for a module that never had one
     * @return the directory that holds the module's files
     */
    @Beta
    @Sunset(reason = "An add-on's files live in its own plugin folder again, so deleting that folder uninstalls it",
            removeInVersion = "2.0.0", replacement = "pluginFolder(String, String, File)")
    default File moduleFolder(String folder, String moduleId, @Nullable File legacyDir) {
        if (legacyDir == null) throw new UnsupportedOperationException("this registry has no module folders");
        register(folder, legacyDir, moduleId);
        return legacyDir;
    }

    /**
     * The add-on's folder, {@code dir}: a <b>dedicated</b> sub-folder of its plugin's data folder,
     * by convention {@code new File(getDataFolder(), "project")}, created if missing and registered
     * like {@link #register(String, File, String)} under {@code folder}: key {@code addon:<folder>},
     * published and versioned like any project, listed under the module in the editor, never
     * renamed or deleted from it. Read and write the module's files in the returned directory. Call
     * it in {@code onEnable}, before writing any default file. Deleting the plugin's data folder
     * then removes the add-on's files; Artisan keeps only its database rows (Versions, drafts).
     *
     * <p>{@code plugins/Artisan/modules/<folder>/}, where {@link #moduleFolder} kept it, moves to
     * {@code dir} once, when {@code dir} is missing or empty. Its Versions and drafts follow, and
     * qualified references ({@code <folder>:<id>}) keep resolving. While both directories hold
     * files, or when the move fails, the old folder stays registered and is returned, with an
     * error in the log: Artisan never picks which copy is the right one.
     *
     * @param folder the project id, as passed to {@link #moduleFolder} before: lowercase letters,
     *        digits, {@code _} and {@code -}
     * @param dir never the data folder itself (every file under it would be project content), nor
     *        a folder of {@code plugins/Artisan/}
     * @return the directory that holds the module's files
     * @throws IllegalArgumentException for an invalid {@code folder} or {@code dir}
     */
    @Beta
    default File pluginFolder(String folder, String moduleId, File dir) {
        dir.mkdirs();
        register(folder, dir, moduleId);
        return dir;
    }
}
