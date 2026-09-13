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
class ProjectRoots(
    val coreRoot: File,
    private val logger: java.util.logging.Logger? = null,
) : net.artisanmc.modules.api.ProjectRootRegistry {

    /** projectId -> project dir, for Add-on-owned projects registered at onEnable. */
    private val registered = ConcurrentHashMap<String, File>()

    val copier: ProjectCopier by lazy { ProjectCopier(this, onRecoveryFailure = { error ->
        logger?.log(java.util.logging.Level.WARNING, "[Artisan] Copy receipt recovery failed; affected targets remain isolated.", error)
    }) }

    val renamer: ProjectRenamer by lazy {
        ProjectRenamer(this) { operationId, error ->
            logger?.log(java.util.logging.Level.WARNING, "[Artisan] Rename $operationId blocked; affected project roots remain isolated until recovery.", error)
        }
    }

    fun isRegistered(projectId: String): Boolean = registered.keys.any { it.equals(projectId, ignoreCase = File.separatorChar == '\\') }

    fun descriptors(): List<Map<String, String>> = all().keys.map {
        mapOf("project_id" to it, "identity" to if (isRegistered(it)) "addon" else "folder")
    }

    /**
     * Notifié à chaque racine enregistrée.
     *
     * Un Add-on s'active APRÈS le core — 9 s plus tard en conditions réelles — et
     * n'enregistre sa racine qu'à ce moment. Le lecteur du core doit donc pouvoir
     * en tenir compte : sans ça, tout ce qui est capturé au chargement (dont
     * l'instantané servi à l'éditeur) ignore les projects d'Add-on pour de bon.
     */
    @Volatile var onRegister: ((String, File) -> Unit)? = null

    @Synchronized
    override fun register(projectId: String, dir: File) {
        // A core-root directory of the same id is now shadowed — invisible to
        // read, hash, sync and the scanner. Silent shadowing is a trap: the copy
        // still looks like a live project on disk, and the day this Add-on fails
        // to enable, nothing registers the root, `all()` re-exposes the stale
        // tree, and the divergence banner (default: disk) offers to push it over
        // the real one. One WARN for post-mortem — house "no theater" rule.
        val shadowed = File(coreRoot, projectId)
        if (shadowed.isDirectory && shadowed.canonicalFile != dir.canonicalFile) {
            logger?.warning(
                "[Artisan] Add-on project root '$projectId' -> ${dir.path} shadows the stale copy " +
                "at ${shadowed.path}, which is no longer read or synced. Delete or move it away: " +
                "if this Add-on ever fails to load, that copy becomes the live project."
            )
        }
        registered[projectId] = dir
        onRegister?.invoke(projectId, dir)
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
    @Synchronized
    fun all(): Map<String, File> {
        renamer // Recover pending moves before any runtime discovery.
        copier // Recover copy activation receipts before exposing destination directories.
        val out = sortedMapOf<String, File>()
        coreRoot.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith(".") && !renamer.isPending(it.name) && !copier.isPending(it.name) }
            ?.forEach { out[it.name] = it }
        registered.forEach { (id, dir) -> if (!renamer.isPending(id)) out[id] = dir }
        return out.filterValues { dir ->
            runCatching { ProjectPublisher(dir).recover() }.onFailure {
                logger?.log(java.util.logging.Level.WARNING, "[Artisan] Publication recovery blocked; project remains isolated: ${dir.name}", it)
            }.isSuccess
        }
    }
}
