package net.artisanmc.plugin.project

import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.DocumentLayout
import java.io.File

data class ResourceEntry(val projectId: String, val path: String, val origin: String)

/** Live disk inventory for commercial editor rights. Parsing YAML is deliberately unnecessary. */
object ResourceInventory {
    /**
     * The kind of a Document-shaped file: a `.yaml`/`.yml` under a kind folder, at
     * the module root or in themed folders ([DocumentLayout]). Lenient on purpose —
     * a file the reader refuses (invalid YAML, misplaced) still counts.
     */
    fun kind(path: String): String? {
        val parts = path.replace('\\', '/').split('/')
        if (parts.size < 2 || parts.any { it.isEmpty() || it.startsWith('.') }) return null
        if (parts.first() in DocumentLayout.RESOURCE_DIRS) return null
        if (!parts.last().endsWith(".yaml", true) && !parts.last().endsWith(".yml", true)) return null
        return parts.dropLast(1).firstNotNullOfOrNull { DocumentKinds.byDir(it)?.kind }
    }

    fun scan(roots: ProjectRoots): List<ResourceEntry> {
        val core = roots.coreRoot
        if (!core.isDirectory || !core.canRead()) error("inventory_unavailable")
        val personal = core.listFiles() ?: error("inventory_unavailable")
        val sources = personal.filter { it.isDirectory && !it.name.startsWith('.') && !roots.isRegistered(it.name) }
            .map { Triple(it.name, it, "personal") } +
            roots.registeredRoots().map { (id, dir) -> Triple(id, dir, "module") }
        return sources.flatMap { (id, dir, origin) ->
            if (!dir.isDirectory || !dir.canRead()) error("inventory_unavailable: $id")
            dir.walkTopDown().maxDepth(DocumentLayout.MAX_DEPTH + 3)
                .onEnter { it == dir || !(it.name.startsWith('.') || (it.parentFile == dir && it.name in DocumentLayout.RESOURCE_DIRS)) }
                .onFail { _, error -> throw IllegalStateException("inventory_unavailable: $id", error) }
                .filter(File::isFile).mapNotNull { file ->
                    val path = file.relativeTo(dir).invariantSeparatorsPath
                    if (kind(path) == null) null else ResourceEntry(id, path, origin)
                }.toList()
        }.sortedWith(compareBy(ResourceEntry::projectId, ResourceEntry::path))
    }
}
