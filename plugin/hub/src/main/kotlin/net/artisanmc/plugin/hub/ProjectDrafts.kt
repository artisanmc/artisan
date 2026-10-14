package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
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
    /** The fingerprint and result of an operation already applied. */
    fun receipt(operationId: String): Pair<String, String>?
    fun commit(server: String, folder: String, id: String, draft: String, status: String, operationId: String, fingerprint: String, result: String): Boolean
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

    fun handle(server: String, folder: String, request: ObjectNode, publisher: Publisher, respond: (Map<String, Any?>) -> Unit) {
        try {
            handleOrThrow(server, folder, request, publisher, respond)
        } catch (e: IllegalArgumentException) {
            respond(fail(e.message?.takeIf { it.matches(Regex("[a-z_]+")) } ?: "invalid_draft"))
        } catch (e: Exception) {
            respond(fail("storage_error") + ("message" to e.message))
        }
    }

    private fun handleOrThrow(server: String, folder: String, request: ObjectNode, publisher: Publisher, respond: (Map<String, Any?>) -> Unit) {
        val action = request.path("action").asText()
        val owner = request.path("owner_id").asText().ifBlank { return respond(fail("invalid_owner")) }
        if (action == "list") {
            val all = storage.drafts(server, folder)?.map { mapper.readTree(it) as ObjectNode } ?: return respond(fail("unknown_project"))
            return respond(ok("drafts" to all.filter { it["ownerId"].asText() == owner && it["status"].asText() == "active" }))
        }
        if (!storage.knownProject(server, folder)) return respond(fail("unknown_project"))
        val id = request.path("draft_id").asText().ifEmpty { return respond(fail("invalid_draft")) }
        fun stored() = storage.draft(server, folder, id)?.let { mapper.readTree(it) as ObjectNode }?.takeIf { it["id"].asText() == id }
        val current = stored()
        if (current != null && current["ownerId"].asText() != owner) return respond(fail("draft_not_found"))
        if (action == "read") return respond(current?.let { ok("draft" to it) } ?: fail("draft_not_found"))
        if (action == "read_blob") {
            val hash = request.path("hash").asText()
            if (current == null || hash !in hashes(current["snapshot"])) return respond(fail("not_found"))
            val bytes = storage.content(hash) ?: return respond(fail("not_found"))
            return respond(ok("content_base64" to Base64.getEncoder().encodeToString(bytes)))
        }

        val operationId = request.path("operation_id").asText().takeIf { it.length in 1..256 } ?: return respond(fail("invalid_operation"))
        val fingerprint = BundleHasher.hashBytes(mapper.writeValueAsBytes(request.deepCopy().also { it.remove(listOf("request_id", "project_id", "type")) }))
        /** The answer an operation already gave, its draft read again. */
        fun replay(printed: String, result: String): Map<String, Any?> {
            if (printed != fingerprint) return fail("operation_conflict")
            val saved = mapper.readTree(result) as ObjectNode
            if (saved.has("draft")) stored()?.let { saved.set<JsonNode>("draft", it) }
            return map(saved)
        }
        storage.receipt(operationId)?.let { (printed, result) -> return respond(replay(printed, result)) }
        fun commit(draft: ObjectNode, result: Map<String, Any?>) {
            val status = draft["status"].asText()
            val kept = result.mapValues { (key, value) -> if (key == "draft") mapOf("revision" to draft["revision"].asLong()) else value }
            val written = try {
                storage.commit(server, folder, id, mapper.writeValueAsString(draft), status, operationId, fingerprint, mapper.writeValueAsString(kept))
            } catch (e: Exception) {
                // The same operation, sent twice at once: the other request's receipt is the answer.
                val (printed, saved) = storage.receipt(operationId) ?: throw e
                return respond(replay(printed, saved))
            }
            if (!written) return respond(fail("unknown_project"))
            respond(result)
        }

        if (action == "create") {
            if (current != null) return respond(fail("draft_conflict"))
            val name = request.path("name").asText()
            val snapshot = request["snapshot"]
            val invalid = if (snapshot == null) "snapshot missing" else invalidBody(name, snapshot)
            if (invalid != null) return respond(fail("invalid_draft") + ("message" to invalid))
            val now = Instant.now().toString()
            val draft = mapper.valueToTree<ObjectNode>(
                mapOf(
                    "schema" to "artisan-draft/v1", "id" to id, "ownerId" to owner, "name" to name, "revision" to 1, "status" to "active",
                    "snapshot" to snapshot, "updatedBy" to owner, "source" to request.path("source").asText("manual"),
                    "createdAt" to now, "updatedAt" to now,
                ),
            )
            return commit(draft, ok("draft" to draft))
        }
        if (current == null) return respond(fail("draft_not_found"))
        if (current["status"].asText() != "active") return respond(fail("draft_closed"))
        if (!request.path("expected_revision").isIntegralNumber || request["expected_revision"].asLong() != current["revision"].asLong())
            return respond(mapOf("ok" to false, "error" to "draft_conflict", "draft" to current))

        if (action == "write_blob") {
            val hash = request.path("hash").asText()
            val bytes = runCatching { Base64.getDecoder().decode(request.path("content_base64").asText()) }.getOrNull()
            if (bytes == null || bytes.size > MAX_BLOB || BundleHasher.hashBytes(bytes) != hash) return respond(fail("invalid_blob"))
            storage.putContent(hash, bytes)
            return commit(current, ok("draft" to current))
        }
        val next = current.deepCopy().apply {
            put("revision", current["revision"].asLong() + 1)
            put("updatedAt", Instant.now().toString())
            put("updatedBy", owner)
        }
        when (action) {
            "update" -> {
                val name = request.path("name").asText()
                val snapshot = request["snapshot"]
                val invalid = if (snapshot == null) "snapshot missing" else invalidBody(name, snapshot)
                if (invalid != null) return respond(fail("invalid_draft") + ("message" to invalid))
                next.put("name", name)
                next.set<JsonNode>("snapshot", snapshot)
                commit(next, ok("draft" to next))
            }
            "discard" -> commit(next.put("status", "discarded"), ok("draft" to next))
            "publish" -> {
                val blobs = newBlobs(current["snapshot"]) ?: return respond(fail("missing_blob"))
                val message = mapOf(
                    "type" to "project_draft_publish", "project_id" to folder, "operation_id" to operationId,
                    "draft" to current, "blobs" to blobs,
                    "author_id" to request.path("author_id").asText(""), "author_name" to request.path("author_name").asText(""),
                )
                publisher.publish(message) { reply ->
                    if (reply["ok"] != true) return@publish respond(reply - setOf("type", "request_id"))
                    next.put("status", "published")
                    commit(next, ok("draft" to next, "wrote" to reply["wrote"]))
                }
            }
            else -> respond(fail("invalid_action"))
        }
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
        ProjectPathPolicy.valid(path) && (!path.startsWith('.') || path == ".artisan/editor.yaml") && !ProjectPathPolicy.isPrivate(path)

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
