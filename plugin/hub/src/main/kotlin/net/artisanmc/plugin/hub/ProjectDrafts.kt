package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.hub.DraftRequest.Create
import net.artisanmc.plugin.hub.DraftRequest.Discard
import net.artisanmc.plugin.hub.DraftRequest.ListDrafts
import net.artisanmc.plugin.hub.DraftRequest.OnDraft
import net.artisanmc.plugin.hub.DraftRequest.Operation
import net.artisanmc.plugin.hub.DraftRequest.Publish
import net.artisanmc.plugin.hub.DraftRequest.Read
import net.artisanmc.plugin.hub.DraftRequest.ReadBlob
import net.artisanmc.plugin.hub.DraftRequest.Revised
import net.artisanmc.plugin.hub.DraftRequest.Update
import net.artisanmc.plugin.hub.DraftRequest.WriteBlob
import net.artisanmc.plugin.project.ProjectPathPolicy
import net.artisanmc.plugin.sync.BundleHasher
import java.time.Instant
import java.util.Base64

/**
 * Where Drafts live: the suite database. False from [knownProject], null from [drafts] or false
 * from [commit]: no such Project recorded. [commit] throws when the operation's receipt is
 * already there (a concurrent replay won); the caller answers with that receipt.
 */
interface DraftStorage {
    fun knownProject(server: String, folder: String): Boolean
    /** Every draft of the Project, whole: the list only, the other actions read one draft. */
    fun drafts(server: String, folder: String): List<String>?
    fun draft(server: String, folder: String, id: String): String?
    /** The receipt of an operation already applied. */
    fun receipt(operationId: String): DraftReceipt?
    fun commit(server: String, folder: String, commit: DraftCommit): Boolean
    fun content(hash: String): ByteArray?
    fun putContent(hash: String, bytes: ByteArray)
}

/**
 * Private Drafts, kept by the hub in the suite database (ADR `server-identity-and-versions`,
 * decision 12): editable while their server is offline. Publishing is the server's write: the
 * draft and its new blobs go to it, and the draft is marked published once it answers. A replayed
 * operation gives back the result it already gave (its receipt keeps the result without the
 * draft's body: the draft is read again, so receipts stay small); a publication replayed after
 * a lost answer is recognised by the server under the same `operation_id`.
 *
 * Errors, by code (the hub maps them to statuses in [ErrorStatus]): `unknown_project` (no such
 * Project recorded), `draft_not_found` (no such draft of this owner), `draft_conflict` (revision
 * moved; the current draft comes along), `draft_closed` (published or discarded), `operation_conflict`
 * (operation id reused with other content), `invalid_*`/`missing_blob` (refused as sent),
 * `storage_error` (the database failed).
 */
class ProjectDrafts(private val storage: DraftStorage) {
    private val mapper = Call.mapper

    /** Sends a publication to the Project's server; answers with its reply. */
    fun interface Publisher {
        fun publish(message: Map<String, Any?>, reply: (Map<String, Any?>) -> Unit)
    }

    /** [request] is a `project_draft_request` as the server would get it; its fingerprint is taken on that JSON. */
    fun handle(server: String, folder: String, request: ObjectNode, publisher: Publisher, respond: (Map<String, Any?>) -> Unit) {
        try {
            handleOrThrow(server, folder, request, publisher, respond)
        } catch (e: IllegalArgumentException) {
            respond(fail(e.message?.takeIf { it.matches(Regex("[a-z_]+")) } ?: "invalid_draft"))
        } catch (e: Exception) {
            respond(fail("storage_error") + ("message" to e.message))
        }
    }

    private fun handleOrThrow(server: String, folder: String, node: ObjectNode, publisher: Publisher, respond: (Map<String, Any?>) -> Unit) {
        val owner = node.path("owner_id").asText().ifBlank { return respond(fail("invalid_owner")) }
        when (val request = DraftRequest.parse(node, owner) ?: return respond(fail("invalid_action"))) {
            is ListDrafts -> respond(list(server, folder, owner))
            is OnDraft -> onDraft(Target(server, folder, request.draftId), request, node, publisher, respond)
        }
    }

    /** One draft of a Project, as stored. */
    private inner class Target(val server: String, val folder: String, val id: String) {
        fun stored(): Draft? = storage.draft(server, folder, id)?.let { Draft(mapper.readTree(it) as ObjectNode) }?.takeIf { it.id == id }
    }

    private fun list(server: String, folder: String, owner: String): Map<String, Any?> {
        val all = storage.drafts(server, folder)?.map { Draft(mapper.readTree(it) as ObjectNode) } ?: return fail("unknown_project")
        return ok("drafts" to all.filter { it.ownerId == owner && it.status == DraftStatus.ACTIVE }.map { it.json })
    }

    private fun onDraft(target: Target, request: OnDraft, node: ObjectNode, publisher: Publisher, respond: (Map<String, Any?>) -> Unit) {
        if (!storage.knownProject(target.server, target.folder)) return respond(fail("unknown_project"))
        if (target.id.isEmpty()) return respond(fail("invalid_draft"))
        val current = target.stored()
        if (current != null && current.ownerId != request.ownerId) return respond(fail("draft_not_found"))
        when (request) {
            is Read -> respond(current?.let { ok("draft" to it.json) } ?: fail("draft_not_found"))
            is ReadBlob -> respond(readBlob(current, request.hash))
            is Operation -> {
                if (request.operationId.length !in 1..256) return respond(fail("invalid_operation"))
                val applying = Applying(target, request.operationId, fingerprint(node), respond)
                storage.receipt(request.operationId)?.let { return respond(applying.replay(it)) }
                when (request) {
                    is Create -> create(applying, current, request)
                    is Revised -> revise(applying, current, request, publisher)
                }
            }
        }
    }

    private fun readBlob(current: Draft?, hash: String): Map<String, Any?> {
        if (current == null || hash !in hashes(current.snapshot)) return fail("not_found")
        val bytes = storage.content(hash) ?: return fail("not_found")
        return ok("content_base64" to Base64.getEncoder().encodeToString(bytes))
    }

    /** What identifies an operation's content: the request less its envelope. */
    private fun fingerprint(node: ObjectNode) =
        BundleHasher.hashBytes(mapper.writeValueAsBytes(node.deepCopy().also { it.remove(listOf("request_id", "project_id", "type")) }))

    /** An operation being applied to [target]: its commit, or the answer it already gave. */
    private inner class Applying(val target: Target, val operationId: String, val fingerprint: String, val respond: (Map<String, Any?>) -> Unit) {
        /** The answer an operation already gave, its draft read again. */
        fun replay(receipt: DraftReceipt): Map<String, Any?> {
            if (receipt.fingerprint != fingerprint) return fail("operation_conflict")
            val saved = mapper.readTree(receipt.result) as ObjectNode
            if (saved.has("draft")) target.stored()?.let { saved.set<JsonNode>("draft", it.json) }
            return map(saved)
        }

        fun commit(draft: Draft, result: Map<String, Any?>) {
            val status = draft.status ?: throw IllegalStateException("draft status ${draft.json.path("status")}")
            val kept = result.mapValues { (key, value) -> if (key == "draft") mapOf("revision" to draft.revision) else value }
            val receipt = DraftReceipt(operationId, fingerprint, mapper.writeValueAsString(kept))
            val written = try {
                storage.commit(target.server, target.folder, DraftCommit(target.id, mapper.writeValueAsString(draft.json), status, receipt))
            } catch (e: Exception) {
                // The same operation, sent twice at once: the other request's receipt is the answer.
                val saved = storage.receipt(operationId) ?: throw e
                return respond(replay(saved))
            }
            if (!written) return respond(fail("unknown_project"))
            respond(result)
        }
    }

    private fun create(applying: Applying, current: Draft?, request: Create) {
        if (current != null) return applying.respond(fail("draft_conflict"))
        invalid(request.name, request.snapshot)?.let { return applying.respond(it) }
        val now = Instant.now().toString()
        val draft = Draft(
            mapper.valueToTree(
                mapOf(
                    "schema" to "artisan-draft/v1", "id" to request.draftId, "ownerId" to request.ownerId, "name" to request.name,
                    "revision" to 1, "status" to DraftStatus.ACTIVE.wire, "snapshot" to request.snapshot, "updatedBy" to request.ownerId,
                    "source" to request.source, "createdAt" to now, "updatedAt" to now,
                ),
            ),
        )
        applying.commit(draft, ok("draft" to draft.json))
    }

    /** Checks shared by the writes on an existing draft, then the write itself. */
    private fun revise(applying: Applying, current: Draft?, request: Revised, publisher: Publisher) {
        if (current == null) return applying.respond(fail("draft_not_found"))
        if (current.status != DraftStatus.ACTIVE) return applying.respond(fail("draft_closed"))
        if (request.expectedRevision != current.revision)
            return applying.respond(mapOf("ok" to false, "error" to "draft_conflict", "draft" to current.json))
        when (request) {
            is WriteBlob -> writeBlob(applying, current, request)
            is Update -> update(applying, next(current, request), request)
            is Discard -> next(current, request).withStatus(DraftStatus.DISCARDED).let { applying.commit(it, ok("draft" to it.json)) }
            is Publish -> publish(applying, current, next(current, request), request, publisher)
        }
    }

    /** [current]'s next revision, by [request]'s owner. */
    private fun next(current: Draft, request: Revised) = Draft(
        current.json.deepCopy().apply {
            put("revision", current.revision + 1)
            put("updatedAt", Instant.now().toString())
            put("updatedBy", request.ownerId)
        },
    )

    private fun writeBlob(applying: Applying, current: Draft, request: WriteBlob) {
        val bytes = runCatching { Base64.getDecoder().decode(request.contentBase64) }.getOrNull()
        if (bytes == null || bytes.size > MAX_BLOB || BundleHasher.hashBytes(bytes) != request.hash) return applying.respond(fail("invalid_blob"))
        storage.putContent(request.hash, bytes)
        applying.commit(current, ok("draft" to current.json))
    }

    private fun update(applying: Applying, next: Draft, request: Update) {
        invalid(request.name, request.snapshot)?.let { return applying.respond(it) }
        next.json.put("name", request.name)
        next.json.set<JsonNode>("snapshot", request.snapshot)
        applying.commit(next, ok("draft" to next.json))
    }

    private fun publish(applying: Applying, current: Draft, next: Draft, request: Publish, publisher: Publisher) {
        val blobs = newBlobs(current.json["snapshot"]) ?: return applying.respond(fail("missing_blob"))
        val message = mapOf(
            "type" to "project_draft_publish", "project_id" to applying.target.folder, "operation_id" to applying.operationId,
            "draft" to current.json, "blobs" to blobs, "author_id" to request.authorId, "author_name" to request.authorName,
        )
        publisher.publish(message) { reply ->
            if (reply["ok"] != true) return@publish applying.respond(reply - setOf("type", "request_id"))
            applying.commit(next.withStatus(DraftStatus.PUBLISHED), ok("draft" to next.json, "wrote" to reply["wrote"]))
        }
    }

    private fun Draft.withStatus(status: DraftStatus) = also { json.put("status", status.wire) }

    /** The refusal of a body that cannot be a draft's; null when it can. */
    private fun invalid(name: String, snapshot: JsonNode?): Map<String, Any?>? {
        val invalid = if (snapshot == null) "snapshot missing" else invalidBody(name, snapshot)
        return invalid?.let { fail("invalid_draft") + ("message" to it) }
    }

    /** The bytes of each binary the draft changes, which the server does not have yet. */
    private fun newBlobs(snapshot: JsonNode): Map<String, String>? {
        val before = snapshot["binaryBaseline"]
        val out = linkedMapOf<String, String>()
        snapshot["binaryTree"]?.fields()?.forEach { (path, ref) ->
            val hash = ref["hash"].asText()
            if (before?.get(path)?.get("hash")?.asText() == hash || hash in out) return@forEach
            out[hash] = Base64.getEncoder().encodeToString(storage.content(hash) ?: return null)
        }
        return out
    }

    private fun hashes(snapshot: JsonNode?): Set<String> =
        listOf("binaryTree", "binaryBaseline").flatMap { key -> snapshot?.get(key)?.fields()?.asSequence()?.map { it.value["hash"].asText() }?.toList().orEmpty() }.toSet()

    private fun contentPath(path: String) =
        ProjectPathPolicy.valid(path) && !net.artisanmc.plugin.project.ProjectMetadataPaths.isHiddenFromEditor(path)

    /** Why [snapshot] cannot be a draft body; null when it can. */
    private fun invalidBody(name: String, snapshot: JsonNode): String? {
        fun badPath(node: JsonNode?) = node?.fieldNames()?.asSequence()?.firstOrNull { !contentPath(it) }
        fun tree(key: String): String? {
            val node = snapshot[key] ?: return "$key missing"
            if (!node.isObject || node.size() > 5000) return "$key is not an object of at most 5000 files"
            badPath(node)?.let { return "$key: path not allowed: $it" }
            return node.fields().asSequence().firstOrNull { !it.value.isTextual }?.let { "$key: not text: ${it.key}" }
        }
        fun binary(key: String): String? {
            val node = snapshot[key] ?: return null
            if (!node.isObject || node.size() > 5000) return "$key is not an object of at most 5000 files"
            badPath(node)?.let { return "$key: path not allowed: $it" }
            return node.fields().asSequence().firstOrNull {
                !it.value.isObject || !it.value.path("hash").asText().matches(SHA256) ||
                    !it.value.path("size").isIntegralNumber || it.value.path("size").asLong() !in 0..MAX_BLOB.toLong()
            }?.let { "$key: bad entry: ${it.key}" }
        }
        if (name.isBlank() || name.length > 120) return "name must be 1 to 120 characters"
        tree("baseline")?.let { return it }
        tree("tree")?.let { return it }
        if (snapshot.has("initialTree")) tree("initialTree")?.let { return it }
        if (!snapshot.path("at").isNumber || snapshot.path("at").asDouble() < 0) return "at must be a positive number"
        binary("binaryBaseline")?.let { return it }
        binary("binaryTree")?.let { return it }
        if (mapper.writeValueAsBytes(snapshot).size > 8 * 1024 * 1024) return "snapshot larger than 8 MB"
        val textPaths = snapshot["baseline"].fieldNames().asSequence().toSet() + snapshot["tree"].fieldNames().asSequence().toSet()
        (snapshot["binaryBaseline"]?.fieldNames()?.asSequence().orEmpty() + snapshot["binaryTree"]?.fieldNames()?.asSequence().orEmpty())
            .firstOrNull { it in textPaths }?.let { return "both text and binary: $it" }
        val renames = snapshot["renames"] ?: return null
        if (!renames.isArray || renames.size() > 5000) return "renames is not a list of at most 5000"
        val from = mutableSetOf<String>()
        val to = mutableSetOf<String>()
        return renames.firstOrNull { r ->
            !(r.path("from").isTextual && r.path("to").isTextual && contentPath(r["from"].asText()) && contentPath(r["to"].asText()) &&
                r["from"] != r["to"] && from.add(r["from"].asText()) && to.add(r["to"].asText()))
        }?.let { "bad rename: $it" }
    }

    @Suppress("UNCHECKED_CAST")
    private fun map(node: JsonNode): Map<String, Any?> = mapper.convertValue(node, Map::class.java) as Map<String, Any?>
    private fun ok(vararg values: Pair<String, Any?>): Map<String, Any?> = mapOf("ok" to true) + values
    private fun fail(error: String): Map<String, Any?> = mapOf("ok" to false, "error" to error)

    private companion object {
        const val MAX_BLOB = 20 * 1024 * 1024
        val SHA256 = Regex("[a-f0-9]{64}")
    }
}
