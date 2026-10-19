package net.artisanmc.plugin.project

import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Resolves a `projectId` to the directory that holds its working copy, unioning
 * the core projects root (`plugins/Artisan/projects/`, scanned by directory name)
 * with **Add-on-owned roots** an Add-on registers at `onEnable` (ADR
 * `addon-owned-project-roots`). An Add-on registers a *dedicated* directory it
 * owns, never its plugin data folder root: every file under a project dir is
 * project content.
 *
 * Discovery ([all]) and every `projectId -> File` resolution ([dirFor]) go through
 * here so the core's read/hash/publish/trash/hot-reload operate per root.
 * On a `projectId` collision across roots, the registered Add-on root wins.
 */
private const val KEY_FILE = ".artisan/project-id"

class ProjectRoots(
    val coreRoot: File,
    private val logger: java.util.logging.Logger? = null,
) : net.artisanmc.modules.api.project.ProjectRootRegistry {

    /** projectId -> project dir, for Add-on-owned projects registered at onEnable. */
    private val registered = ConcurrentHashMap<String, File>()
    /** projectId -> owning module id, when the Add-on named it at registration. */
    private val owners = ConcurrentHashMap<String, String>()
    /** Registered roots that hold a module's configuration, not content (ADR `module-config-screens`). */
    private val configRoots = ConcurrentHashMap.newKeySet<String>()

    fun isRegistered(projectId: String): Boolean = registered.keys.any { it.equals(projectId, ignoreCase = File.separatorChar == '\\') }
    fun registeredRoots(): Map<String, File> = registered.toMap()

    fun descriptors(): List<Map<String, String>> = all().keys.map { descriptor(it) }

    /** `project_roots` entry: identity, plus the owning module of an Add-on root when known. */
    fun descriptor(projectId: String): Map<String, String> {
        val identity = mapOf(
            "project_id" to projectId, "identity" to if (isRegistered(projectId)) "addon" else "folder", "project_key" to key(projectId),
        )
        val owner = owners[projectId] ?: return identity
        val role = if (projectId in configRoots) mapOf("role" to "config") else emptyMap()
        return identity + ("module_id" to owner) + role
    }

    /**
     * Notified for each registered root.
     *
     * An Add-on enables AFTER the core (seconds later in practice) and only then
     * registers its root. The core reader must account for it: otherwise everything
     * captured at load (including the snapshot served to the editor) ignores Add-on
     * projects for good.
     */
    @Volatile var onRegister: ((String, File) -> Unit)? = null

    @Synchronized
    override fun register(projectId: String, dir: File) {
        // A core-root directory of the same id is now shadowed: invisible to every
        // read. Silent shadowing is a trap: the copy still looks like a live project
        // on disk, and the day this Add-on fails to enable, nothing registers the
        // root and `all()` re-exposes the stale tree. One WARN for post-mortem.
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

    override fun register(projectId: String, dir: File, moduleId: String) {
        owners[projectId] = moduleId
        register(projectId, dir)
    }

    override fun registerConfig(projectId: String, dir: File, moduleId: String) {
        configRoots.add(projectId)
        register(projectId, dir, moduleId)
    }

    /**
     * The project's lasting identity (ADR `server-identity-and-versions`): an Add-on's manifest
     * id, else a UUID written once in `.artisan/project-id` — metadata the editor never sees, so
     * a renamed folder keeps it and only the plugin writes it.
     */
    fun key(projectId: String): String {
        if (isRegistered(projectId)) return "addon:$projectId"
        val file = File(dirFor(projectId), KEY_FILE)
        return file.takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() } ?: newKey(file)
    }

    private fun newKey(file: File): String = java.util.UUID.randomUUID().toString().also {
        file.parentFile.mkdirs()
        file.writeText("$it\n")
    }

    /** A copied folder arrives with the key of its source: the later folder by name gets a new one. */
    private fun dedupeKeys(folders: Map<String, File>) {
        val seen = HashMap<String, String>()
        for ((projectId, dir) in folders) {
            if (isRegistered(projectId)) continue
            val file = File(dir, KEY_FILE)
            val key = file.takeIf { it.isFile }?.readText()?.trim() ?: continue
            val first = seen.putIfAbsent(key, projectId) ?: continue
            newKey(file)
            logger?.warning("[Artisan] Project '$projectId' had the same id as '$first' (a copied folder?): it got a new one.")
        }
    }

    /** The project dir for [projectId]: a registered Add-on root, else `<coreRoot>/<projectId>`. */
    fun dirFor(projectId: String): File = registered[projectId] ?: File(coreRoot, projectId)

    /**
     * All known projects, projectId -> dir: the core root scanned by directory name
     * (hidden dirs excluded) unioned with registered Add-on roots, which win on a
     * projectId collision. Ordered by projectId.
     */
    @Synchronized
    fun all(): Map<String, File> {
        val out = sortedMapOf<String, File>()
        coreRoot.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith(".") }
            ?.forEach { out[it.name] = it }
        out.putAll(registered)
        dedupeKeys(out)
        return out.filterValues { dir ->
            runCatching { ProjectPublisher(dir).recover() }.onFailure {
                logger?.log(java.util.logging.Level.WARNING, "[Artisan] Publication recovery blocked; project remains isolated: ${dir.name}", it)
            }.isSuccess
        }
    }
}
