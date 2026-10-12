package net.artisanmc.plugin.project

import net.artisanmc.modules.api.ProjectContentApi
import java.io.File

class ProjectContentReader(
    private val roots: ProjectRoots,
    /** Reprise de l'instantané — câblée sur le provider, absente en test. */
    private val onReloadRequested: () -> Unit = {},
) : ProjectContentApi {

    override fun reload() = onReloadRequested()

    override fun projectIds(): List<String> = roots.all().keys.toList()

    override fun list(projectId: String, dir: String): List<String> = synchronized(roots) {
        val root = resolve(projectId, dir) ?: return emptyList()
        if (!root.isDirectory) return emptyList()
        return root.walkTopDown()
            .onEnter { !java.nio.file.Files.isSymbolicLink(it.toPath()) }
            .filter { file ->
                file.isFile && !java.nio.file.Files.isSymbolicLink(file.toPath()) && !file.relativeTo(root).path
                    .split('/', '\\')
                    .any { it.startsWith(".artisan", ignoreCase = true) }
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

    /** Rejette la traversée hors project ('..', séparateurs dans l'id) et le namespace .artisan*. */
    private fun resolve(projectId: String, relPath: String): File? {
        if (!ProjectPathPolicy.valid(projectId) || projectId.contains('/') || projectId.startsWith('.')) return null
        if (ProjectPathPolicy.isPrivate(relPath) || relPath.split('/', '\\').any { it.startsWith(".artisan", ignoreCase = true) }) return null
        return runCatching {
            val projectRoot = roots.all()[projectId] ?: return null
            if (relPath.isEmpty()) projectRoot else ProjectPathPolicy.resolve(projectRoot, relPath)
        }.getOrNull()
    }
}
