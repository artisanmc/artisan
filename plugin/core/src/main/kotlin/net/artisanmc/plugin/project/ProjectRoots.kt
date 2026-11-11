package net.artisanmc.plugin.project

import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Resolves a `projectId` to the directory that holds its working copy, unioning
 * the core projects root (`plugins/Artisan/modules/`, scanned by directory name)
 * with **Add-on-owned roots** an Add-on registers at `onEnable` (ADR
 * `addon-owned-project-roots`). An Add-on registers a *dedicated* directory it
 * owns, never its plugin data folder root: every file under a project dir is
 * project content.
 *
 * Discovery ([all]) and every `projectId -> File` resolution ([dirFor]) go through
 * here so the core's read/hash/publish/trash/hot-reload operate per root.
 * On a `projectId` collision across roots, the registered Add-on root wins.
 *
 * [all] answers from a listing taken once and kept until [invalidate]: a reload
 * invalidates it before reading, a registration invalidates it too. Nothing here
 * holds a lock while the disk is read at length, so the main thread (a module's
 * `onEnable`, `api.project.list`) never waits behind a reload.
 */
private const val KEY_FILE = ".artisan/project-id"
private val FOLDER = Regex("^[a-z0-9][a-z0-9_-]*$")

class ProjectRoots(
    val coreRoot: File,
    private val logger: java.util.logging.Logger? = null,
    /** The server's start moves the modules root's folders to `.yml` ([YmlMigration]); other readers leave the disk as it is. */
    private val moveToYml: Boolean = false,
) : net.artisanmc.modules.api.project.ProjectRootRegistry {

    /** projectId -> project dir, for Add-on-owned projects registered at onEnable. */
    private val registered = ConcurrentHashMap<String, File>()
    /** projectId -> owning module id, when the Add-on named it at registration. */
    private val owners = ConcurrentHashMap<String, String>()
    /** Registered roots that hold a module's configuration, not content (ADR `module-config-screens`). */
    private val configRoots = ConcurrentHashMap.newKeySet<String>()
    /** Project dirs whose interrupted publications were replayed: a commit replays its own, so only a crash leaves one. */
    private val recovered = ConcurrentHashMap.newKeySet<String>()
    /** Folders of the modules root already moved to `.yml` by this start ([YmlMigration]). */
    private val migrated = ConcurrentHashMap.newKeySet<String>()

    /** The listing [all] serves, with the keys its scan read; null until the next scan. */
    private class Listing(val dirs: Map<String, File>, val keys: Map<String, String>)
    @Volatile private var listing: Listing? = null
    /** Held while a scan runs (a directory listing and one small file per project), never longer. */
    private val scanLock = Any()
    /** Serializes registrations; [all] does not take it. */
    private val registryLock = Any()

    /** The module that registered [projectId]'s root, null for a folder of the core root. */
    fun ownerOf(projectId: String): String? = owners[projectId]

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

    override fun register(projectId: String, dir: File): Unit = synchronized(registryLock) {
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
        invalidate()
        onRegister?.invoke(projectId, dir)
    }

    override fun register(projectId: String, dir: File, moduleId: String) {
        owners[projectId] = moduleId
        register(projectId, dir)
    }

    /**
     * `<coreRoot>/<folder>`, registered like an Add-on root: same `addon:<folder>` key (its
     * Versions and drafts follow), not renamed or deleted from the editor. [legacyDir] moves there
     * once; while both hold files, or when the move fails, [legacyDir] stays the root.
     */
    override fun moduleFolder(folder: String, moduleId: String, legacyDir: File?): File = synchronized(registryLock) {
        require(FOLDER.matches(folder)) { "invalid module folder '$folder'" }
        val target = File(coreRoot, folder)
        val legacy = legacyDir?.takeIf { it.isDirectory && it.canonicalFile != target.canonicalFile && !it.list().isNullOrEmpty() }
        if (legacy != null) {
            if (target.exists()) {
                logger?.severe(
                    "[Artisan] Module '$moduleId': both ${legacy.path} and ${target.path} exist, ${legacy.path} stays " +
                    "the module's folder. Merge them into ${target.path} and delete ${legacy.path}.",
                )
                register(folder, legacy, moduleId)
                return@synchronized legacy
            }
            try {
                target.parentFile.mkdirs()
                ModulesRootMigration.move(legacy, target)
            } catch (e: java.io.IOException) {
                logger?.severe("[Artisan] Module '$moduleId': could not move ${legacy.path} to ${target.path} (${e.message}), it keeps its old folder.")
                register(folder, legacy, moduleId)
                return@synchronized legacy
            }
            logger?.info("[Artisan] Module '$moduleId' moved from ${legacy.path} to ${target.path}.")
        }
        target.mkdirs()
        stampModuleKey(folder, target)
        register(folder, target, moduleId)
        return@synchronized target
    }

    /**
     * A module's folder sits in the core root, where it is a plain folder until its module
     * registers it (seconds after the editor answers, at startup). Its key file says `addon:<folder>`
     * so that window reads the same key: else a request then gets a new UUID, and the owner's
     * draft splits in two rows.
     */
    private fun stampModuleKey(folder: String, dir: File) {
        val file = File(dir, KEY_FILE)
        val key = "addon:$folder"
        if (file.takeIf { it.isFile }?.readText()?.trim() == key) return
        file.parentFile.mkdirs()
        file.writeText("$key\n")
        invalidate()
    }

    /** A key file naming another module's folder: a copy of it, which is not that module. */
    private fun foreignAddonKey(projectId: String, key: String): Boolean =
        key.startsWith("addon:") && key != "addon:$projectId"

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
        listing?.keys?.get(projectId)?.let { return it }
        val file = File(dirFor(projectId), KEY_FILE)
        return file.takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() && !foreignAddonKey(projectId, it) } ?: newKey(file)
    }

    private fun newKey(file: File): String = java.util.UUID.randomUUID().toString().also {
        file.parentFile.mkdirs()
        file.writeText("$it\n")
    }

    /**
     * The keys of the folders of the core root. A copied folder arrives with the key of its
     * source: the later folder by name gets a new one. A folder without one gets it on [key].
     */
    private fun readKeys(folders: Map<String, File>): Map<String, String> {
        val keys = HashMap<String, String>()
        val seen = HashMap<String, String>()
        for ((projectId, dir) in folders) {
            if (isRegistered(projectId)) continue
            val file = File(dir, KEY_FILE)
            val key = file.takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() } ?: continue
            if (foreignAddonKey(projectId, key)) {
                keys[projectId] = newKey(file)
                continue
            }
            val first = seen.putIfAbsent(key, projectId)
            if (first == null) {
                keys[projectId] = key
                continue
            }
            keys[projectId] = newKey(file)
            logger?.warning("[Artisan] Project '$projectId' had the same id as '$first' (a copied folder?): it got a new one.")
        }
        return keys
    }

    /**
     * Once per start, a folder of the modules root (a module's own `moduleFolder` included) moves
     * to `.yml`. An Add-on root elsewhere, and a configuration root, stay as their Add-on reads them.
     */
    private fun migrateToYml(projectId: String, dir: File) {
        if (!moveToYml || projectId in configRoots || !migrated.add(dir.absolutePath)) return
        if (dir.absoluteFile.parentFile?.canonicalFile != coreRoot.canonicalFile) return
        runCatching { YmlMigration.run(dir, logger) }.onFailure {
            logger?.log(java.util.logging.Level.WARNING, "[Artisan] ${dir.name}: moving its files to .yml failed, they are read as they are", it)
        }
    }

    /** Forgets the listing: the next [all] lists the disk again. */
    fun invalidate() {
        listing = null
    }

    /** The project dir for [projectId]: a registered Add-on root, else `<coreRoot>/<projectId>`. */
    fun dirFor(projectId: String): File = registered[projectId] ?: File(coreRoot, projectId)

    /**
     * All known projects, projectId -> dir: the core root scanned by directory name
     * (hidden dirs excluded) unioned with registered Add-on roots, which win on a
     * projectId collision. Ordered by projectId. The listing of the last scan, until
     * [invalidate]: a folder created by hand shows after the next reload.
     */
    fun all(): Map<String, File> = (listing ?: scan()).dirs

    private fun scan(): Listing = synchronized(scanLock) {
        listing?.let { return it }
        val out = sortedMapOf<String, File>()
        coreRoot.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith(".") }
            ?.forEach { out[it.name] = it }
        out.putAll(registered)
        val keys = readKeys(out)
        // Once per dir: every module read goes through here, and two directory listings per
        // project and per read add up to seconds on a slow disk.
        val dirs = out.filterValues { dir ->
            dir.absolutePath in recovered || runCatching { ProjectPublisher(dir).recover() }.onFailure {
                logger?.log(java.util.logging.Level.WARNING, "[Artisan] Publication recovery blocked; project remains isolated: ${dir.name}", it)
            }.isSuccess.also { if (it) recovered += dir.absolutePath }
        }
        dirs.forEach { (projectId, dir) -> migrateToYml(projectId, dir) }
        Listing(dirs, keys).also { listing = it }
    }
}
