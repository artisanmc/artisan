package net.artisanmc.plugin.project

import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Resolves a `projectId` to the directory that holds its working copy, unioning
 * the core projects root (`plugins/Artisan/projects/`, scanned by directory name)
 * with **Add-on-owned roots** an Add-on registers at `onEnable` (ADR
 * `addon-owned-project-roots`). An Add-on registers a *dedicated* directory it
 * owns — never its plugin data folder root, since bundle sync deletes files under
 * a project dir that aren't in the bundle.
 *
 * Discovery ([all]) and every `projectId -> File` resolution ([dirFor]) go through
 * here so the core's read/hash/download-sweep/trash/hot-reload operate per root.
 * On a `projectId` collision across roots, the registered Add-on root wins.
 */
class ProjectRoots(val coreRoot: File) {

    /** projectId -> project dir, for Add-on-owned projects registered at onEnable. */
    private val registered = ConcurrentHashMap<String, File>()

    fun register(projectId: String, dir: File) {
        registered[projectId] = dir
    }

    /** The project dir for [projectId]: a registered Add-on root, else `<coreRoot>/<projectId>`. */
    fun dirFor(projectId: String): File = registered[projectId] ?: File(coreRoot, projectId)

    /** Where [projectId]'s move-to-trash lands: `.artisan-trash` beside its dir (per-root). */
    fun trashDirFor(projectId: String): File = File(dirFor(projectId).parentFile, ".artisan-trash")

    /**
     * All known projects, projectId -> dir: the core root scanned by directory name
     * (hidden dirs excluded) unioned with registered Add-on roots, which win on a
     * projectId collision. Ordered by projectId.
     */
    fun all(): Map<String, File> {
        val out = sortedMapOf<String, File>()
        coreRoot.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith(".") }
            ?.forEach { out[it.name] = it }
        registered.forEach { (id, dir) -> out[id] = dir }
        return out
    }
}
