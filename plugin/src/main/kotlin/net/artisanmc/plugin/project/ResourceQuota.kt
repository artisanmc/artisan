package net.artisanmc.plugin.project

object ResourceQuota {
    fun assess(
        quota: Int,
        pro: Boolean,
        inventory: List<ResourceEntry>,
        projectId: String,
        module: Boolean,
        files: List<String> = emptyList(),
        deletes: List<String> = emptyList(),
        renames: List<Pair<String, String>> = emptyList(),
    ): String? {
        if (module) return null
        val limit = if (pro) 250 else quota
        val existing = inventory.filter { it.origin == "personal" }.map { it.projectId to it.path }.toMutableSet()
        val before = existing.size
        val removesRoot = deletes.any { ResourceInventory.kind(it) != null && (projectId to it) in existing }
        if (before > limit && (files.isNotEmpty() || renames.isNotEmpty() || deletes.isNotEmpty() && !removesRoot)) return "free_quota_exceeded"
        deletes.filter { ResourceInventory.kind(it) != null }.forEach { existing.remove(projectId to it) }
        renames.forEach { (from, to) ->
            if (ResourceInventory.kind(from) != null) existing.remove(projectId to from)
            if (ResourceInventory.kind(to) != null) existing.add(projectId to to)
        }
        files.filter { ResourceInventory.kind(it) != null }.forEach { existing.add(projectId to it) }
        return if (existing.size > limit) "free_quota_reached" else null
    }
}
