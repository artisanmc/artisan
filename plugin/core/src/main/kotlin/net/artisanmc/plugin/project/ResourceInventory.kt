package net.artisanmc.plugin.project

import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.DocumentLayout
import java.io.File

data class ResourceEntry(val projectId: String, val path: String, val origin: String)

/**
 * Inventory of the Document-shaped files for commercial editor rights, from the loaded
 * snapshot: no walk of the disk per `project_list` or per reload. Parsing YAML is
 * deliberately unnecessary.
 */
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

    /** The Document-shaped text files of [snapshot]; a registered root's are `module`, a core folder's `personal`. */
    fun of(snapshot: ProjectSnapshot, roots: ProjectRoots): List<ResourceEntry> =
        snapshot.files.flatMap { (id, files) ->
            val origin = if (roots.isRegistered(id)) "module" else "personal"
            files.keys.filter { kind(it) != null }.map { ResourceEntry(id, it, origin) }
        }.sortedWith(compareBy(ResourceEntry::projectId, ResourceEntry::path))
}
