package net.artisanmc.plugin.project

import net.artisanmc.modules.api.project.ProjectContentApi
import net.artisanmc.plugin.model.RuntimeRawDocument
import net.artisanmc.plugin.engine.RuntimeProject
import java.io.File

/**
 * `api.project`: the Projects as the last load read them. [list] and [read] answer from
 * the loaded [snapshot], without a lock and without walking the disk: a module's
 * `onEnable` or `onReload()` on the main thread never waits behind a reload or an
 * editor write. A Project the snapshot does not hold yet (a folder registered a moment
 * ago, read at the next tick) is read from the disk, and so is a file the snapshot
 * lacks (one the module just wrote, before its `reload()`).
 */
class ProjectContentReader(
    private val roots: ProjectRoots,
    /** Snapshot reload: wired to the provider, absent in tests. */
    private val onReloadRequested: () -> Unit = {},
    /** The loaded Projects, read at call time: wired to the provider, `[]` before it exists and in tests. */
    private val runtimes: () -> List<RuntimeProject> = { emptyList() },
    /** The loaded files, read at call time: wired to the provider, empty before it exists and in tests. */
    private val snapshot: () -> ProjectSnapshot = { ProjectSnapshot.EMPTY },
) : ProjectContentApi {

    override fun reload() = onReloadRequested()

    /**
     * The Documents of a module kind as the last load read them (W6): raw
     * mappings plus `id`. A core kind has a typed reader, not a raw one, so it
     * answers `[]` here as the contract says.
     */
    override fun documents(projectId: String, kind: String): List<Map<String, Any?>> =
        runtimes().firstOrNull { it.projectId == projectId }
            ?.documents?.get(kind).orEmpty()
            .filterIsInstance<RuntimeRawDocument>()
            .map { it.toWire() }

    override fun projectIds(): List<String> = roots.all().keys.toList()

    override fun list(projectId: String, dir: String): List<String> {
        val projectRoot = roots.all()[projectId] ?: return emptyList()
        val root = resolve(projectId, dir) ?: return emptyList()
        // The metadata rule reads paths from the Project's folder, not from `dir`.
        val prefix = root.relativeTo(projectRoot).invariantSeparatorsPath.let { if (it.isEmpty()) "" else "$it/" }
        val loaded = snapshot()
        val paths: Sequence<String> = if (projectId in loaded.files) {
            loaded.files.getValue(projectId).keys.asSequence() + loaded.binaries[projectId].orEmpty().keys.asSequence()
        } else {
            if (!root.isDirectory) return emptyList()
            root.walkTopDown()
                .onEnter { !java.nio.file.Files.isSymbolicLink(it.toPath()) }
                .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) }
                .map { prefix + it.relativeTo(root).invariantSeparatorsPath }
        }
        return paths
            .filter { it.startsWith(prefix) && !ProjectMetadataPaths.isHiddenFromContent(it) }
            .map { it.removePrefix(prefix) }
            .sorted()
            .toList()
    }

    override fun read(projectId: String, relPath: String): String? {
        val projectRoot = roots.all()[projectId] ?: return null
        val f = resolve(projectId, relPath) ?: return null
        snapshot().files[projectId]?.get(f.relativeTo(projectRoot).invariantSeparatorsPath)?.let { return it }
        return if (f.isFile) f.readText(Charsets.UTF_8) else null
    }

    override fun hasContent(dir: String): Boolean = projectIds().any { list(it, dir).isNotEmpty() }

    /** Rejects traversal out of the project ('..', separators in the id) and the .artisan* namespace. */
    private fun resolve(projectId: String, relPath: String): File? {
        if (!ProjectPathPolicy.valid(projectId) || projectId.contains('/') || projectId.startsWith('.')) return null
        if (ProjectMetadataPaths.isHiddenFromContent(relPath)) return null
        return runCatching {
            val projectRoot = roots.all()[projectId] ?: return null
            if (relPath.isEmpty()) projectRoot else ProjectPathPolicy.resolve(projectRoot, relPath)
        }.getOrNull()
    }
}
