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

    override fun list(projectId: String, dir: String): List<String> {
        val root = resolve(projectId, dir) ?: return emptyList()
        if (!root.isDirectory) return emptyList()
        return root.walkTopDown()
            .filter { file ->
                file.isFile && !file.relativeTo(root).path
                    .split('/', '\\')
                    .any { it.startsWith(".artisan") }
            }
            .map { it.relativeTo(root).path.replace('\\', '/') }
            .sorted()
            .toList()
    }

    override fun read(projectId: String, relPath: String): String? {
        val f = resolve(projectId, relPath) ?: return null
        return if (f.isFile) f.readText(Charsets.UTF_8) else null
    }

    override fun hasContent(dir: String): Boolean = projectIds().any { pid ->
        resolve(pid, dir)?.let { it.isDirectory && !it.listFiles().isNullOrEmpty() } == true
    }

    /** Rejette la traversée hors project ('..', séparateurs dans l'id) et le namespace .artisan*. */
    private fun resolve(projectId: String, relPath: String): File? {
        if (projectId.contains("..") || projectId.contains('/') || projectId.contains('\\')) return null
        if (relPath.split('/', '\\').any { it == ".." || it.startsWith(".artisan") }) return null
        return runCatching {
            val projectRoot = roots.dirFor(projectId).canonicalFile
            val target = File(projectRoot, relPath).canonicalFile
            val inside = target == projectRoot ||
                target.path.startsWith(projectRoot.path + File.separator)
            if (inside) target else null
        }.getOrNull()
    }
}
