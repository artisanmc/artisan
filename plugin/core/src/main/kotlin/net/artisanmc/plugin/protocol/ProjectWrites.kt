package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.PublicationAuthor
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.DraftPublication
import net.artisanmc.plugin.project.ProjectFolders
import net.artisanmc.plugin.project.ProjectPathPolicy
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.protocol.EditorRequest.ConfigWrite
import net.artisanmc.plugin.protocol.EditorRequest.ProjectCreate
import net.artisanmc.plugin.protocol.EditorRequest.ProjectDelete
import net.artisanmc.plugin.protocol.EditorRequest.ProjectDraftPublish
import net.artisanmc.plugin.protocol.EditorRequest.ProjectRename
import net.artisanmc.plugin.protocol.EditorRequest.ProjectWrite
import net.artisanmc.plugin.project.ContentHash
import net.artisanmc.plugin.model.YamlFiles
import net.artisanmc.plugin.project.ProjectMetadataPaths
import net.artisanmc.plugin.project.ProjectFilesReader
import net.artisanmc.plugin.project.YamlEquivalence
import java.io.File
import java.util.Base64
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The editor's writes. Each is an all-or-nothing compare-and-swap: `base_hash`
 * describes the expected state, a single file that moved cancels everything, and
 * nothing is written before everything is checked and decoded.
 */
class ProjectWrites(
    private val workspace: ProjectWorkspace,
    private val replies: Replies,
    private val send: (Map<String, Any?>) -> Unit,
    private val logger: Logger?,
    private val check: DocumentCheck = DocumentCheck(),
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
            val projectDir = roots.dirFor(projectId)
            if (!projectDir.isDirectory) {
                // A new Project has no folder yet: created only on request, otherwise
                // a mistyped id would leave a ghost folder.
                if (!request.create) return@offThread reply.error("unknown_project")
                if (!projectDir.mkdirs()) return@offThread reply.error("write_error", "mkdir failed")
            }
            try {
                if (mutations.replayed(projectDir, request.message, reply)) return@offThread
                val decoded = binaries.associate { b -> b.path to b.contentBase64?.let { Base64.getDecoder().decode(it) } }
                val conflicts = conflicts(projectDir, request, binaries)
                if (conflicts.isNotEmpty()) {
                    // The disk content travels with the conflict (diff without a second round
                    // trip), and so does the folder's real state: a rename done by hand looks
                    // like a delete, and "keep my version" would recreate the old file.
                    val onDisk = ProjectFilesReader.readAll(projectDir).keys.filter { !EditorPaths.isInvisible(it) }.sorted()
                    return@offThread reply.send(mapOf("ok" to false, "error" to "conflict", "conflicts" to conflicts, "disk_files" to onDisk))
                }
                val renamed = request.renames.associate { it.to to ProjectPathPolicy.resolve(projectDir, it.from).readText(Charsets.UTF_8) }
                refused(projectId, projectDir, renamed + request.writes.associate { it.path to it.content }, request.deletes.map { it.path } + request.renames.map { it.from })
                    ?.let { return@offThread reply.send(it) }
                mutations.commit(projectDir, request.message, changes(projectDir, request, decoded))
                noteAuthor(projectId, request.message)
                workspace.reload(setOf(projectId))
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
                if (current?.let(ContentHash::hashContent) == expected) null else mapOf("path" to from, "disk" to current),
                // The destination must be free: a rename never overwrites an existing file.
                if (dest.exists()) mapOf("path" to to, "disk" to dest.takeIf { it.isFile }?.readText(Charsets.UTF_8)) else null,
            )
        }
        val binary = binaries.mapNotNull { b ->
            val actual = ProjectPathPolicy.resolve(projectDir, b.path).takeIf { it.isFile }?.readBytes()?.let(ContentHash::hashBytes)
            if (actual == b.baseHash) null else mapOf("path" to b.path, "disk" to null)
        }
        val text = (request.writes.map { it.path to it.baseHash } + request.deletes.map { it.path to it.baseHash })
            .mapNotNull { (path, expected) ->
                val current = textOf(path)
                if (current?.let(ContentHash::hashContent) == expected) null else mapOf("path" to path, "disk" to current)
            }
        return renames + binary + text
    }

    /**
     * A rename carries an intent the tree cannot rebuild: without it, the trash would
     * archive a false delete and the history would lose its file.
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
        // Renamed AND modified: the source is archived under its new name.
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

    /** Config screen table write: a plain disk change, then reload. */
    fun config(request: ConfigWrite) {
        val reply = replies.to(request, "config_write_result")
        val (_, projectId, writes, deletes) = request
        if (!EditorPaths.isSafeProjectId(projectId) ||
            writes.any { !EditorPaths.isSafeRelPath(it.first) } || deletes.any { !EditorPaths.isSafeRelPath(it) }
        ) return reply.error("invalid_path")
        replies.offThread("config_write", workspace.io) {
            val projectDir = roots.dirFor(projectId)
            if (!projectDir.isDirectory) return@offThread reply.error("unknown_project")
            try {
                if (mutations.replayed(projectDir, request.message, reply)) return@offThread
                val changes = writes.associate { (path, content) -> path to content.toByteArray(Charsets.UTF_8) }.toMutableMap<String, ByteArray?>()
                deletes.forEach { changes[it] = null }
                mutations.commit(projectDir, request.message, changes)
                workspace.reload(setOf(projectId))
                reply.ok()
            } catch (e: Throwable) {
                reply.failure("write_error", "config_write '$projectId'", e)
            }
        }
    }

    fun create(request: ProjectCreate) =
        folder(request, "project_create", touched = setOf(request.projectId)) { it.create(request.projectId) }

    fun delete(request: ProjectDelete) =
        folder(request, "project_delete", request.projectId, setOf(request.projectId)) { it.delete(request.projectId) }

    fun rename(request: ProjectRename) =
        folder(request, "project_rename", request.projectId, setOf(request.projectId, request.targetId)) {
            it.rename(request.projectId, request.targetId)
        }

    /** A Project folder created, trashed or renamed, then [touched] reloaded before the reply. */
    private fun folder(
        request: EditorRequest.WithReply, type: String, source: String? = null, touched: Set<String>,
        operation: (ProjectFolders) -> String?,
    ) {
        val reply = replies.to(request, "${type}_result")
        if (source != null && !EditorPaths.isSafeProjectId(source)) return reply.error("invalid_path")
        replies.offThread(type, workspace.io) {
            try {
                operation(ProjectFolders(roots))?.let { return@offThread reply.error(it) }
                workspace.reload(touched)
                reply.ok()
            } catch (e: Throwable) {
                reply.failure("write_error", type, e)
            }
        }
    }

    /** Publishes a Draft the hub keeps. The reply goes out before the reload. */
    fun publishDraft(request: ProjectDraftPublish) = replies.offThread("project_draft_publish", workspace.io) {
        val projectId = request.projectId
        val result: JsonNode = try {
            val root = roots.dirFor(projectId)
            when {
                !EditorPaths.isSafeProjectId(projectId) -> mapper.valueToTree<JsonNode>(mapOf("ok" to false, "error" to "invalid_path"))
                !root.isDirectory -> mapper.valueToTree<JsonNode>(mapOf("ok" to false, "error" to "unknown_project"))
                else -> draftRefused(projectId, root, request.message) ?: DraftPublication(root).publish(request.message)
            }
        } catch (error: Exception) {
            logger?.log(Level.WARNING, "[Artisan] Draft publication failed", error)
            mapper.valueToTree<JsonNode>(mapOf("ok" to false, "error" to "storage_error"))
        }
        val payload = mapper.convertValue(result, Map::class.java).entries.associate { it.key.toString() to it.value }.toMutableMap()
        payload["type"] = "project_draft_publish_result"
        payload["request_id"] = request.requestId
        send(payload)
        if (result.path("ok").asBoolean()) {
            noteAuthor(projectId, request.message, request.message.path("draft").path("snapshot").path("restoredFrom").asText("").ifEmpty { null })
            try {
                workspace.reload(setOf(projectId))
            } catch (error: Exception) {
                logger?.log(Level.WARNING, "[Artisan] Draft published but runtime reload failed", error)
            }
        }
    }

    /** A draft's text changes: the tree against its baseline. */
    private fun draftRefused(projectId: String, root: File, message: JsonNode): JsonNode? {
        val snapshot = message.path("draft").path("snapshot")
        fun texts(key: String) = snapshot.path(key).fields().asSequence().filter { it.value.isTextual }.associate { it.key to it.value.asText() }
        val baseline = texts("baseline")
        val tree = texts("tree")
        return refused(projectId, root, tree.filter { (path, text) -> baseline[path]?.let { YamlEquivalence.sameValue(path, it, text) } != true }, baseline.keys - tree.keys)
            ?.let { mapper.valueToTree<JsonNode>(it) }
    }

    /**
     * Deploying refuses files that would not load, by the check an AI client's drafts pass
     * (`DocumentCheck`, ADR `mcp-server`): the refusal names each file and what is wrong.
     * Metadata (`.artisan/editor.yaml`) is not a Document and is not checked. Null: nothing to refuse.
     */
    private fun refused(projectId: String, root: File, files: Map<String, String>, deletes: Collection<String>): Map<String, Any?>? {
        val written = files.mapKeys { (path, _) -> YamlFiles.onDisk(root, path) }
        val paths = written.keys.filter { !ProjectMetadataPaths.isMeta(it) }
        if (paths.isEmpty()) return null
        val tree = workspace.snapshot.files[projectId] ?: emptyMap()
        val problems = check.check(projectId, tree, written, deletes.map { YamlFiles.onDisk(root, it) }, paths)
        if (problems.isEmpty()) return null
        return mapOf(
            "ok" to false, "error" to "invalid_documents",
            // One line per problem: the editor's failure dialog shows `message` as is.
            "message" to problems.joinToString("\n") { "${it.path}: ${it.message}" },
            "problems" to problems.map { mapOf("path" to it.path, "stage" to it.stage, "message" to it.message) },
        )
    }

    private fun noteAuthor(projectId: String, message: JsonNode, restoredFrom: String? = null) {
        val id = message.path("author_id").asText("").ifEmpty { return }
        workspace.authoredBy(projectId, PublicationAuthor(id, message.path("author_name").asText(""), restoredFrom))
    }

    private companion object {
        val OPERATION_ID = Regex("[A-Za-z0-9_-]{1,128}")
    }
}
