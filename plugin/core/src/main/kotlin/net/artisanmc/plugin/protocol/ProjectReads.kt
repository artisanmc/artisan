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

/** Ce que l'éditeur lit d'un Project : l'instantané chargé, ou le disque pour les binaires et l'historique. */
class ProjectReads(private val workspace: ProjectWorkspace, private val replies: Replies) {
    private val roots get() = workspace.roots

    /**
     * La liste se demande, elle ne se mémorise pas côté backend : le nom du
     * dossier EST l'identité (ADR `server-disk-only-storage`). Même sémantique que
     * [read] : ce que le serveur a chargé, sinon on listerait un Project qu'on ne
     * peut pas ouvrir.
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
     * L'instantané, pas le disque : l'éditeur montre ce que le serveur a lu. Les
     * binaires sont annoncés, pas portés (ADR `assets-on-server-disk`, décision 4).
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

    /** Même garde que l'écriture : on ne lit l'historique que d'un fichier que l'éditeur pourrait écrire. */
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
                // Un fichier jamais écrasé n'a pas d'archive : liste vide, pas une erreur.
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

    /** Les octets d'un asset, lus sur le disque au moment de la demande : le hash rendu décrit ce qui est rendu. */
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

    /** Une table d'écran de config (ADR `module-config-screens`) : un dossier de YAML ou un fichier. */
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
         * Garde-fou de `project_read` — l'arbre entier d'un Project sur le fil.
         * Mesuré le 2026-08-12 sur les deux vrais projects du devstack : 7,9 Ko et
         * 43 Ko. Deux ordres de grandeur de marge : un plafond qui répond
         * `too_large` au lieu de tronquer.
         */
        const val MAX_PROJECT_BYTES = 8 * 1024 * 1024
        const val MAX_CONFIG_BYTES = 1024 * 1024
    }
}
