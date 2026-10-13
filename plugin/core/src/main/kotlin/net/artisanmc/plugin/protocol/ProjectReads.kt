package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.ProjectPathPolicy
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.project.ResourceInventory
import net.artisanmc.plugin.protocol.EditorRequest.AssetRead
import net.artisanmc.plugin.protocol.EditorRequest.ConfigRead
import net.artisanmc.plugin.protocol.EditorRequest.ProjectHistory
import net.artisanmc.plugin.protocol.EditorRequest.ProjectList
import net.artisanmc.plugin.protocol.EditorRequest.ProjectRead
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader
import java.nio.file.Files
import java.util.Base64

/** What the editor reads from a Project: the loaded snapshot, or the disk for binaries and history. */
class ProjectReads(private val workspace: ProjectWorkspace, private val replies: Replies) {
    private val roots get() = workspace.roots

    /**
     * The folder name IS the identity (ADR `server-disk-only-storage`). Same
     * semantics as [read]: what the server loaded, otherwise the list would show a
     * Project that cannot be opened.
     */
    fun list(request: ProjectList) {
        val reply = replies.to(request, "project_list_result")
        replies.offThread("project_list") {
            try {
                val ids = workspace.snapshot.projectIds
                val inventory = ResourceInventory.scan(roots).map { entry ->
                    mapOf("project_id" to entry.projectId, "path" to entry.path, "origin" to entry.origin)
                }
                reply.ok("project_ids" to ids, "project_roots" to ids.map { roots.descriptor(it) }, "resource_inventory" to inventory)
            } catch (e: Throwable) {
                reply.failure("read_error", "project_list", e)
            }
        }
    }

    /**
     * The snapshot, not the disk: the editor shows what the server read. Binaries
     * are announced, not carried (ADR `assets-on-server-disk`).
     */
    fun read(request: ProjectRead) {
        val reply = replies.to(request, "project_read_result")
        val projectId = request.projectId
        if (!EditorPaths.isSafeProjectId(projectId)) return reply.error("invalid_path")
        replies.offThread("project_read") {
            try {
                val snapshot = workspace.snapshot
                val tree = snapshot.files[projectId] ?: return@offThread reply.error("unknown_project")
                val hash = snapshot.hash(projectId)
                if (request.ifHash != null && request.ifHash == hash) return@offThread reply.ok("unchanged" to true, "hash" to hash)
                val files = tree.toSortedMap().map { (rel, content) -> mapOf("path" to rel, "content" to content) }
                if (files.sumOf { it["content"]!!.toByteArray().size } > MAX_PROJECT_BYTES) return@offThread reply.error("too_large")
                reply.ok(
                    "hash" to hash,
                    "files" to files,
                    "failed" to (snapshot.skipped[projectId] ?: emptyMap()).toSortedMap()
                        .map { (rel, reason) -> mapOf("path" to rel, "reason" to reason) },
                    "binaries" to (snapshot.binaries[projectId] ?: emptyMap()).toSortedMap()
                        .map { (rel, info) -> mapOf("path" to rel, "hash" to info.hash, "size" to info.size) },
                )
            } catch (e: Throwable) {
                reply.failure("read_error", "project_read '$projectId'", e)
            }
        }
    }

    /** Same guard as writes: history is only read for a file the editor could write. */
    fun history(request: ProjectHistory) {
        val reply = replies.to(request, "project_history_result")
        val (_, projectId, path) = request
        if (!EditorPaths.isSafeProjectId(projectId) || !EditorPaths.isWritable(path)) return reply.error("invalid_path")
        replies.offThread("project_history", workspace.io) {
            try {
                val projectDir = roots.dirFor(projectId)
                if (!projectDir.isDirectory) return@offThread reply.error("unknown_project")
                ProjectPublisher(projectDir).recover()
                val dir = ProjectPathPolicy.resolve(projectDir, ".artisan/history/$path")
                // A file never overwritten has no archive: empty list, not an error.
                val versions = (dir.listFiles() ?: emptyArray())
                    .filter { it.isFile && !Files.isSymbolicLink(it.toPath()) }
                    .sortedByDescending { it.name }
                    .map { mapOf("at" to (it.name.toLongOrNull() ?: 0L), "content" to it.readText(Charsets.UTF_8)) }
                reply.ok("versions" to versions)
            } catch (e: Throwable) {
                reply.failure("read_error", "project_history '$projectId/$path'", e)
            }
        }
    }

    /** An asset's bytes, read from disk at request time: the returned hash describes what is returned. */
    fun asset(request: AssetRead) {
        val reply = replies.to(request, "asset_read_result")
        val (_, projectId, path) = request
        if (!EditorPaths.isSafeProjectId(projectId) || !EditorPaths.isWritable(path) || !ProjectFilesReader.isBinary(path)) {
            return reply.error("invalid_path")
        }
        replies.offThread("asset_read", workspace.io) {
            try {
                if (!workspace.snapshot.binaries.containsKey(projectId)) return@offThread reply.error("unknown_project")
                val root = roots.dirFor(projectId)
                ProjectPublisher(root).recover()
                val file = ProjectPathPolicy.resolve(root, path)
                if (!file.isFile) return@offThread reply.error("not_found")
                val bytes = file.readBytes()
                reply.ok("content_base64" to Base64.getEncoder().encodeToString(bytes), "hash" to BundleHasher.hashBytes(bytes))
            } catch (e: Throwable) {
                reply.failure("read_error", "asset_read '$projectId/$path'", e)
            }
        }
    }

    /** A config screen table (ADR `module-config-screens`): a folder of YAML files or one file. */
    fun config(request: ConfigRead) {
        val reply = replies.to(request, "config_read_result")
        val (_, projectId, table) = request
        if (!EditorPaths.isSafeProjectId(projectId) || !EditorPaths.isSafeRelPath(table)) return reply.error("invalid_path")
        replies.offThread("config_read", workspace.io) {
            try {
                val projectDir = roots.dirFor(projectId)
                if (!projectDir.isDirectory) return@offThread reply.error("unknown_project")
                ProjectPublisher(projectDir).recover()
                val target = ProjectPathPolicy.resolve(projectDir, table)
                val files = mutableListOf<Map<String, String>>()
                if (target.isDirectory) {
                    target.listFiles()?.sortedBy { it.name }?.forEach { f ->
                        if (f.isFile && !Files.isSymbolicLink(f.toPath()) && !f.name.startsWith(".") &&
                            (f.name.endsWith(".yaml") || f.name.endsWith(".yml"))
                        ) {
                            files.add(mapOf("path" to "$table/${f.name}", "content" to f.readText()))
                        }
                    }
                } else {
                    listOf("$table.yaml", "$table.yml")
                        .map { it to ProjectPathPolicy.resolve(projectDir, it) }
                        .firstOrNull { it.second.isFile }
                        ?.let { (rel, f) -> files.add(mapOf("path" to rel, "content" to f.readText())) }
                }
                if (files.sumOf { it["content"]!!.toByteArray().size } > MAX_CONFIG_BYTES) reply.error("too_large")
                else reply.ok("files" to files)
            } catch (e: Throwable) {
                reply.failure("read_error", "config_read '$projectId/$table'", e)
            }
        }
    }

    companion object {
        /**
         * Safety cap for `project_read`, which sends a Project's whole tree. Real
         * projects weigh tens of KB: two orders of magnitude of margin, answering
         * `too_large` instead of truncating.
         */
        const val MAX_PROJECT_BYTES = 8 * 1024 * 1024
        const val MAX_CONFIG_BYTES = 1024 * 1024
    }
}
