package net.artisanmc.plugin.project

import java.io.File

data class ResourceEntry(val projectId: String, val path: String, val origin: String)

/** Live disk inventory for commercial editor rights. Parsing YAML is deliberately unnecessary. */
object ResourceInventory {
    fun kind(path: String): String? {
        val parts = path.replace('\\', '/').split('/')
        if (parts.size !in 2..3 || parts.drop(1).any { it.isEmpty() || it.startsWith('.') }) return null
        val type = when (parts[0]) {
            "menus" -> "menu"
            "dialogs" -> "dialog"
            "commands" -> "command"
            else -> return null
        }
        if (!parts.last().endsWith(".yaml", true) && !parts.last().endsWith(".yml", true)) return null
        return type
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
            listOf("menus", "dialogs", "commands").flatMap { rootName ->
                val resourceRoot = File(dir, rootName)
                if (!resourceRoot.exists()) return@flatMap emptyList()
                if (!resourceRoot.isDirectory || !resourceRoot.canRead()) error("inventory_unavailable: $id/$rootName")
                resourceRoot.walkTopDown().maxDepth(3)
                    .onFail { _, error -> throw IllegalStateException("inventory_unavailable: $id/$rootName", error) }
                    .filter(File::isFile).mapNotNull { file ->
                    val path = file.relativeTo(dir).invariantSeparatorsPath
                    if (kind(path) == null) null else ResourceEntry(id, path, origin)
                    }.toList()
            }
        }.sortedWith(compareBy(ResourceEntry::projectId, ResourceEntry::path))
    }
}
