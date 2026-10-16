package net.artisanmc.plugin.project

import net.artisanmc.modules.api.project.ProjectContentApi
import net.artisanmc.plugin.model.BundleRawDocument
import net.artisanmc.plugin.model.ProjectBundle
import java.io.File

class ProjectContentReader(
    private val roots: ProjectRoots,
    /** Snapshot reload: wired to the provider, absent in tests. */
    private val onReloadRequested: () -> Unit = {},
    /** The loaded bundles, read at call time: wired to the provider, `[]` before it exists and in tests. */
    private val bundles: () -> List<ProjectBundle> = { emptyList() },
) : ProjectContentApi {

    override fun reload() = onReloadRequested()

    /**
     * The Documents of a module kind as the last load read them (W6): raw
     * mappings plus `id`. A core kind has a typed reader, not a raw one, so it
     * answers `[]` here as the contract says.
     */
    override fun documents(projectId: String, kind: String): List<Map<String, Any?>> =
        bundles().firstOrNull { it.projectId == projectId }
            ?.documents?.get(kind).orEmpty()
            .filterIsInstance<BundleRawDocument>()
            .map { it.toWire() }

    override fun projectIds(): List<String> = roots.all().keys.toList()

    override fun list(projectId: String, dir: String): List<String> = synchronized(roots) {
        val root = resolve(projectId, dir) ?: return emptyList()
        if (!root.isDirectory) return emptyList()
        // The metadata rule reads paths from the Project's folder, not from `dir`.
        val projectRoot = roots.all()[projectId] ?: return emptyList()
        return root.walkTopDown()
            .onEnter { !java.nio.file.Files.isSymbolicLink(it.toPath()) }
            .filter { file ->
                file.isFile && !java.nio.file.Files.isSymbolicLink(file.toPath()) &&
                    !ProjectMetadataPaths.isHiddenFromContent(file.relativeTo(projectRoot).invariantSeparatorsPath)
            }
            .map { it.relativeTo(root).path.replace('\\', '/') }
            .sorted()
            .toList()
    }

    override fun read(projectId: String, relPath: String): String? = synchronized(roots) {
        val f = resolve(projectId, relPath) ?: return null
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
