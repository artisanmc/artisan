package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import java.io.File

/**
 * Lets an Add-on host its Project in its **own plugin dir** instead of the core
 * `plugins/Artisan/projects/` (ADR `addon-owned-project-roots`). Call [register]
 * once from `onEnable(api)`.
 */
@Stable
interface ProjectRootRegistry {
    /**
     * Register that [projectId]'s working copy lives at [dir] — a **dedicated**
     * directory the Add-on owns. Do NOT pass the plugin's data-folder root: the core
     * treats every file under a project dir as project content (read, hashed, shown
     * and edited in the editor), so the dir must hold nothing but that project's files.
     *
     * The core then reads, hashes, publishes, trashes and hot-reloads that project
     * from [dir] (its `.artisan-trash/` sits beside it). On a projectId
     * collision with a core-scanned project, the registered dir wins.
     *
     * The projects are reloaded on the next server tick, once the caller's
     * `onEnable` has returned (since 1.8.0; immediately before): bootstrap content
     * written after this call is picked up, and modules' `onReload()` runs then.
     */
    @Stable fun register(projectId: String, dir: File)

    /**
     * Same as [register], naming the module ([ArtisanModule.getId]) that owns the
     * project: the editor then lists it under that module ("Installed modules") even
     * when the module declares no config screen. Prefer this form.
     */
    @Stable fun register(projectId: String, dir: File, moduleId: String) = register(projectId, dir)

    companion object {
        /** No-op registry (test/default convenience). */
        @Stable val NOOP: ProjectRootRegistry = object : ProjectRootRegistry {
            override fun register(projectId: String, dir: File) {}
        }
    }
}
