package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectDraftStore
import net.artisanmc.plugin.project.ProjectPathPolicy
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.protocol.EditorRequest.ConfigWrite
import net.artisanmc.plugin.protocol.EditorRequest.ProjectDraft
import net.artisanmc.plugin.protocol.EditorRequest.ProjectWrite
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader
import java.io.File
import java.util.Base64
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Les écritures de l'éditeur. Chacune est un compare-and-swap tout-ou-rien :
 * `base_hash` décrit l'état attendu, un seul fichier qui a bougé annule tout,
 * et rien n'est écrit avant que tout soit vérifié et décodé.
 */
class ProjectWrites(
    private val workspace: ProjectWorkspace,
    private val replies: Replies,
    private val send: (Map<String, Any?>) -> Unit,
    private val logger: Logger?,
) {
    private val roots get() = workspace.roots
    private val mutations = ProjectMutations(roots)
    private val mapper = ObjectMapper()

    fun write(request: ProjectWrite) {
        val reply = replies.to(request, "project_write_result")
        val projectId = request.projectId
        val binaries = request.binaries
        if (binaries == null || !isValidWrite(request, binaries)) return reply.error("invalid_path")
        replies.offThread("project_write", workspace.io) {
            if (mutations.deniedByQuota(
                    reply, request.message, projectId,
                    request.writes.map { it.path } + binaries.filter { it.contentBase64 != null }.map { it.path },
                    request.deletes.map { it.path } + binaries.filter { it.contentBase64 == null }.map { it.path },
                    request.renames.map { it.from to it.to },
                )
            ) return@offThread
            val projectDir = roots.dirFor(projectId)
            if (!projectDir.isDirectory) {
                // Un Project neuf n'a pas encore de dossier : créé seulement sur demande,
                // sinon un id mal tapé sèmerait un dossier fantôme.
                if (!request.create) return@offThread reply.error("unknown_project")
                if (!projectDir.mkdirs()) return@offThread reply.error("write_error", "mkdir failed")
            }
            try {
                if (mutations.replayed(projectDir, request.message, reply)) return@offThread
                val decoded = binaries.associate { b -> b.path to b.contentBase64?.let { Base64.getDecoder().decode(it) } }
                val conflicts = conflicts(projectDir, request, binaries)
                if (conflicts.isNotEmpty()) {
                    // Le contenu disque voyage avec le conflit (diff sans second aller-retour),
                    // et l'état réel du dossier aussi : un renommage fait à la main ressemble
                    // à une suppression, et « garder ma version » recréerait l'ancien fichier.
                    val onDisk = ProjectFilesReader.readAll(projectDir).keys.filter { !EditorPaths.isInvisible(it) }.sorted()
                    return@offThread reply.send(mapOf("ok" to false, "error" to "conflict", "conflicts" to conflicts, "disk_files" to onDisk))
                }
                mutations.commit(projectDir, request.message, changes(projectDir, request, decoded))
                workspace.reload()
                reply.ok()
            } catch (e: Throwable) {
                reply.failure("write_error", "project_write '$projectId'", e)
            }
        }
    }

    private fun isValidWrite(request: ProjectWrite, binaries: List<EditorRequest.BinaryWrite>): Boolean {
        val paths = binaries.map { it.path }
        return EditorPaths.isSafeProjectId(request.projectId) &&
            (binaries.isEmpty() || OPERATION_ID.matches(request.operationId)) &&
            request.writes.all { EditorPaths.isWritable(it.path) } &&
            request.deletes.all { EditorPaths.isWritable(it.path) } &&
            paths.all(EditorPaths::isWritable) &&
            paths.size == paths.distinct().size &&
            paths.none { path ->
                request.writes.any { it.path == path } || request.deletes.any { it.path == path } ||
                    request.renames.any { it.from == path || it.to == path }
            } &&
            request.renames.all { EditorPaths.isWritable(it.from) && EditorPaths.isWritable(it.to) }
    }

    private fun conflicts(projectDir: File, request: ProjectWrite, binaries: List<EditorRequest.BinaryWrite>): List<Map<String, String?>> {
        fun textOf(path: String) = ProjectPathPolicy.resolve(projectDir, path).takeIf { it.isFile }?.readText(Charsets.UTF_8)
        val renames = request.renames.flatMap { (from, to, expected) ->
            val current = textOf(from)
            val dest = ProjectPathPolicy.resolve(projectDir, to)
            listOfNotNull(
                if (current?.let(BundleHasher::hashContent) == expected) null else mapOf("path" to from, "disk" to current),
                // La destination doit être libre : un renommage n'écrase jamais un fichier existant.
                if (dest.exists()) mapOf("path" to to, "disk" to dest.takeIf { it.isFile }?.readText(Charsets.UTF_8)) else null,
            )
        }
        val binary = binaries.mapNotNull { b ->
            val actual = ProjectPathPolicy.resolve(projectDir, b.path).takeIf { it.isFile }?.readBytes()?.let(BundleHasher::hashBytes)
            if (actual == b.baseHash) null else mapOf("path" to b.path, "disk" to null)
        }
        val text = (request.writes.map { it.path to it.baseHash } + request.deletes.map { it.path to it.baseHash })
            .mapNotNull { (path, expected) ->
                val current = textOf(path)
                if (current?.let(BundleHasher::hashContent) == expected) null else mapOf("path" to path, "disk" to current)
            }
        return renames + binary + text
    }

    /**
     * Un renommage porte une intention que l'arbre ne reconstitue pas : sans elle, la
     * corbeille archiverait une fausse suppression et l'historique perdrait son fichier.
     */
    private fun changes(projectDir: File, request: ProjectWrite, binaries: Map<String, ByteArray?>): Map<String, ByteArray?> {
        fun resolve(path: String) = ProjectPathPolicy.resolve(projectDir, path)
        val changes = linkedMapOf<String, ByteArray?>()
        val historyMoves = linkedMapOf<String, ByteArray?>()
        request.renames.forEach { (from, to, _) ->
            changes[from] = null
            changes[to] = resolve(from).readBytes()
            val histFrom = resolve(".artisan/history/$from")
            if (histFrom.isDirectory && !resolve(".artisan/history/$to").exists()) {
                histFrom.listFiles()?.filter { it.isFile }?.forEach {
                    historyMoves[".artisan/history/$to/${it.name}"] = it.readBytes()
                    historyMoves[".artisan/history/$from/${it.name}"] = null
                }
            }
        }
        request.writes.forEach { changes[it.path] = it.content.toByteArray(Charsets.UTF_8) }
        request.deletes.forEach { changes[it.path] = null }
        changes.putAll(binaries)
        val renamedFrom = request.renames.map { it.from }.toSet()
        val archived = ProjectPublisher(projectDir).withHistory(changes.filterKeys { it !in renamedFrom }).toMutableMap()
        renamedFrom.forEach { archived[it] = null }
        // Renommé ET modifié : la source s'archive sous son nouveau nom.
        request.renames.forEach { (from, to, _) ->
            val before = resolve(from).readBytes()
            if (changes[to]?.contentEquals(before) == false) {
                var stamp = System.currentTimeMillis()
                while (historyMoves.containsKey(".artisan/history/$to/${"%013d".format(stamp)}")) stamp++
                historyMoves[".artisan/history/$to/${"%013d".format(stamp)}"] = before
            }
        }
        return archived + historyMoves
    }

    /** Écriture d'une table d'écran de config : un simple changement disque, rechargé. */
    fun config(request: ConfigWrite) {
        val reply = replies.to(request, "config_write_result")
        val (_, projectId, writes, deletes) = request
        if (!EditorPaths.isSafeProjectId(projectId) ||
            writes.any { !EditorPaths.isSafeRelPath(it.first) } || deletes.any { !EditorPaths.isSafeRelPath(it) }
        ) return reply.error("invalid_path")
        replies.offThread("config_write", workspace.io) {
            if (mutations.deniedByQuota(reply, request.message, projectId, writes.map { it.first }, deletes)) return@offThread
            val projectDir = roots.dirFor(projectId)
            if (!projectDir.isDirectory) return@offThread reply.error("unknown_project")
            try {
                if (mutations.replayed(projectDir, request.message, reply)) return@offThread
                val changes = writes.associate { (path, content) -> path to content.toByteArray(Charsets.UTF_8) }.toMutableMap<String, ByteArray?>()
                deletes.forEach { changes[it] = null }
                mutations.commit(projectDir, request.message, changes)
                workspace.reload()
                reply.ok()
            } catch (e: Throwable) {
                reply.failure("write_error", "config_write '$projectId'", e)
            }
        }
    }

    /** Brouillons privés (`project_drafts`). La réponse part avant le rechargement d'une publication. */
    fun draft(request: ProjectDraft) = replies.offThread("project_draft_request", workspace.io) {
        val projectId = request.projectId
        val result: JsonNode = try {
            val root = roots.dirFor(projectId)
            when {
                !EditorPaths.isSafeProjectId(projectId) -> mapper.valueToTree<JsonNode>(mapOf("ok" to false, "error" to "invalid_path"))
                !root.isDirectory -> mapper.valueToTree<JsonNode>(mapOf("ok" to false, "error" to "unknown_project"))
                else -> ProjectDraftStore(root) { changes ->
                    mutations.quotaDenial(
                        request.message, projectId,
                        changes.filterValues { it != null }.keys.toList(), changes.filterValues { it == null }.keys.toList(),
                    )
                }.handle(request.message)
            }
        } catch (error: Exception) {
            logger?.log(Level.WARNING, "[Artisan] Private draft operation failed", error)
            mapper.valueToTree<JsonNode>(mapOf("ok" to false, "error" to "storage_error"))
        }
        val payload = mapper.convertValue(result, Map::class.java).entries.associate { it.key.toString() to it.value }.toMutableMap()
        payload["type"] = "project_draft_result"
        payload["request_id"] = request.requestId
        send(payload)
        if (result.path("ok").asBoolean() && request.message.path("action").asText() == "publish") {
            try {
                workspace.reload()
            } catch (error: Exception) {
                logger?.log(Level.WARNING, "[Artisan] Draft published but runtime reload failed", error)
            }
        }
    }

    private companion object {
        val OPERATION_ID = Regex("[A-Za-z0-9_-]{1,128}")
    }
}
