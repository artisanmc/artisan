package net.artisanmc.plugin.project

/*
 * The shapes a server's load is described in, shared by the leaf that writes them and the hub
 * that reads them (two releases may run side by side in a Network). Each converts to and from
 * the JSON-ready maps of the wire and of `artisan_server_state` explicitly: a field missing from
 * an older row reads as empty, a field this release does not know is ignored.
 */

/**
 * A `project_roots` entry: a Project's folder, its identity (`folder`/`addon`), `project_key`, owning module,
 * and its role: `config` for a module's configuration root, listed under the module and not among Projects.
 */
data class ProjectRootInfo(
    val projectId: String, val identity: String? = null, val projectKey: String? = null, val moduleId: String? = null,
    val role: String? = null,
) {
    fun toMap(): Map<String, String> = buildMap {
        put("project_id", projectId)
        identity?.let { put("identity", it) }
        projectKey?.let { put("project_key", it) }
        moduleId?.let { put("module_id", it) }
        role?.let { put("role", it) }
    }

    companion object {
        /** Null for an entry without a `project_id`. */
        fun from(value: Any?): ProjectRootInfo? {
            val map = value as? Map<*, *> ?: return null
            return ProjectRootInfo(
                projectId = map["project_id"] as? String ?: return null,
                identity = map["identity"] as? String, projectKey = map["project_key"] as? String, moduleId = map["module_id"] as? String,
                role = map["role"] as? String,
            )
        }
    }
}

/** A `resource_inventory` entry. */
data class InventoryEntry(val projectId: String, val path: String, val origin: String) {
    fun toMap(): Map<String, String> = mapOf("project_id" to projectId, "path" to path, "origin" to origin)

    companion object {
        fun from(value: Any?): InventoryEntry? {
            val map = value as? Map<*, *> ?: return null
            return InventoryEntry(map["project_id"] as? String ?: return null, map["path"] as? String ?: return null, map["origin"] as? String ?: "")
        }
    }
}

/** The body of a `project_list` reply: the Projects a server loaded. */
data class ProjectListing(
    val projectIds: List<String>,
    val projectRoots: List<ProjectRootInfo>,
    val resourceInventory: List<InventoryEntry> = emptyList(),
) {
    fun root(folder: String): ProjectRootInfo? = projectRoots.firstOrNull { it.projectId == folder }

    fun toMap(): Map<String, Any?> = mapOf(
        "project_ids" to projectIds,
        "project_roots" to projectRoots.map { it.toMap() },
        "resource_inventory" to resourceInventory.map { it.toMap() },
    )

    companion object {
        fun of(snapshot: ProjectSnapshot, roots: ProjectRoots): ProjectListing {
            val ids = snapshot.projectIds
            val inventory = ResourceInventory.of(snapshot, roots).map { InventoryEntry(it.projectId, it.path, it.origin) }
            return ProjectListing(ids, ids.map { ProjectRootInfo.from(roots.descriptor(it))!! }, inventory)
        }

        /** Reads a `project_list` reply, or the list part of a [LoadedState]. */
        fun from(map: Map<*, *>): ProjectListing = ProjectListing(
            projectIds = (map["project_ids"] as? List<*>).orEmpty().filterIsInstance<String>(),
            projectRoots = (map["project_roots"] as? List<*>).orEmpty().mapNotNull(ProjectRootInfo::from),
            resourceInventory = (map["resource_inventory"] as? List<*>).orEmpty().mapNotNull(InventoryEntry::from),
        )
    }
}

/** A file that failed to load, and why. */
data class FailedFile(val path: String, val reason: String) {
    fun toMap(): Map<String, String> = mapOf("path" to path, "reason" to reason)
}

/**
 * One loaded Project: its Snapshot hash, failed files, `.artisan*` metadata the editor reads (outside
 * the Versions), and the images its Documents ask the pack for ([PackImageRequests]), which the hub
 * builds the pack with.
 */
data class LoadedProject(
    val hash: String,
    val failed: List<FailedFile> = emptyList(),
    val meta: Map<String, String> = emptyMap(),
    val packImages: List<PackImageRequest> = emptyList(),
) {
    /** `pack_images` only when some: a row without it reads as none. */
    fun toMap(): Map<String, Any?> = buildMap {
        put("hash", hash)
        put("failed", failed.map { it.toMap() })
        put("meta", meta)
        if (packImages.isNotEmpty()) put("pack_images", packImages.map { it.toMap() })
    }

    companion object {
        fun from(value: Any?): LoadedProject? {
            val map = value as? Map<*, *> ?: return null
            return LoadedProject(
                hash = map["hash"] as? String ?: return null,
                failed = (map["failed"] as? List<*>).orEmpty().mapNotNull { f ->
                    (f as? Map<*, *>)?.let { FailedFile(it["path"] as? String ?: return@mapNotNull null, it["reason"]?.toString() ?: "") }
                },
                meta = (map["meta"] as? Map<*, *>).orEmpty().entries
                    .mapNotNull { (k, v) -> if (k is String && v is String) k to v else null }.toMap(),
                packImages = (map["pack_images"] as? List<*>).orEmpty().mapNotNull(PackImageRequest::from),
            )
        }
    }
}

/**
 * What a server recorded at its last load (`artisan_server_state`, one row per server): its
 * [list] and, per Project, [LoadedProject]. Rows written before [schema] existed read as schema 1.
 */
data class LoadedState(val list: ProjectListing, val projects: Map<String, LoadedProject>, val schema: Int = SCHEMA) {
    fun toMap(): Map<String, Any?> = mapOf("schema" to schema) + list.toMap() + ("projects" to projects.mapValues { it.value.toMap() })

    companion object {
        const val SCHEMA = 1

        /** [packImages]: what a Project's files ask the pack for, from its files ([PackImageRequests]). */
        fun of(
            snapshot: ProjectSnapshot,
            roots: ProjectRoots,
            packImages: (files: Map<String, String>) -> List<PackImageRequest> = { emptyList() },
        ): LoadedState {
            val projects = snapshot.projectIds.associateWith { id ->
                LoadedProject(
                    hash = snapshot.hash(id),
                    failed = snapshot.skipped[id].orEmpty().toSortedMap().map { (path, reason) -> FailedFile(path, reason) },
                    // `.artisan/editor.yaml`: read by the editor, outside the Versions.
                    meta = snapshot.files[id].orEmpty().filterKeys(ContentHash::isArtisanMeta),
                    packImages = packImages(snapshot.files[id].orEmpty().filterKeys { !ContentHash.isArtisanMeta(it) }),
                )
            }
            return LoadedState(ProjectListing.of(snapshot, roots), projects)
        }

        fun from(map: Map<*, *>): LoadedState = LoadedState(
            list = ProjectListing.from(map),
            projects = (map["projects"] as? Map<*, *>).orEmpty().entries
                .mapNotNull { (k, v) -> (k as? String)?.let { key -> LoadedProject.from(v)?.let { key to it } } }.toMap(),
            schema = (map["schema"] as? Number)?.toInt() ?: 1,
        )
    }
}
