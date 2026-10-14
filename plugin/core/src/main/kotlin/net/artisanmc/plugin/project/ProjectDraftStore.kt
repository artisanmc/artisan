package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader
import java.io.File
import java.time.Instant
import java.util.Base64

/** Private draft storage; the authenticated relay supplies the owner, never the editor. */
class ProjectDraftStore(private val root: File) {
    private val mapper = ObjectMapper()
    private val publisher = ProjectPublisher(root)
    private fun response(vararg values: Pair<String, Any?>): JsonNode = mapper.valueToTree(mapOf(*values))
    private fun fail(error: String) = response("ok" to false, "error" to error)
    private fun draftPath(id: String): String {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "invalid_draft" }
        // Encode case-sensitive IDs and Windows device names identically on every OS.
        val directory = if (id.any { it in 'A'..'Z' } || id.matches(Regex("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])"))) "%${BundleHasher.hashContent(id)}" else id
        return ".artisan/drafts/$directory/draft.json"
    }
    private fun read(id: String): JsonNode? = ProjectPathPolicy.resolve(root, draftPath(id)).takeIf { it.isFile }?.let { file ->
        mapper.readTree(file).also { require(it.path("id").asText() == id) { "invalid_draft" } }
    }
    private fun all(): List<JsonNode> = ProjectPathPolicy.resolve(root, ".artisan/drafts").listFiles()?.filter { it.isDirectory && !it.name.startsWith('.') }
        ?.sortedBy { it.name }?.mapNotNull { directory ->
            val file = ProjectPathPolicy.resolve(root, ".artisan/drafts/${directory.name}/draft.json")
            if (!file.isFile) null else mapper.readTree(file).also {
                require(draftPath(it.path("id").asText()) == file.relativeTo(root).invariantSeparatorsPath) { "invalid_draft" }
            }
        }.orEmpty()
    private fun revokedPath(owner: String) = ".artisan/drafts/.revoked/${BundleHasher.hashContent(owner)}"
    private fun revoked(owner: String) = ProjectPathPolicy.resolve(root, revokedPath(owner)).isFile

    fun handle(request: JsonNode): JsonNode {
        try {
            publisher.recover()
            val action = request["action"]?.asText() ?: return fail("invalid_action")
            val owner = request["owner_id"]?.takeIf { it.isTextual && (it.asText().isNotBlank() || action == "list_all") }?.asText() ?: return fail("invalid_owner")
            if (action != "purge_owner" && revoked(owner)) return fail("owner_revoked")
            if (action == "list" || action == "list_all") return response("ok" to true, "drafts" to all().filter { !revoked(it["ownerId"].asText()) && (action == "list_all" || it["ownerId"].asText() == owner && it["status"].asText() == "active") })
            val id = request["draft_id"]?.asText() ?: request["draft"]?.get("id")?.asText()
            val current = id?.let { read(it) }
            if (current != null && current["ownerId"].asText() != owner) return fail("not_found")
            if (action == "read") return current?.let { response("ok" to true, "draft" to it) } ?: fail("not_found")
            if (action == "read_blob") {
                if (current == null) return fail("not_found")
                val hash = request["hash"]?.asText() ?: return fail("invalid_blob")
                val blob = blob(id!!, hash)
                if (!blob.isFile) return fail("not_found")
                return response("ok" to true, "content_base64" to Base64.getEncoder().encodeToString(blob.readBytes()))
            }
            val operationId = request["operation_id"]?.takeIf { it.isTextual && it.asText().length in 1..256 }?.asText() ?: return fail("invalid_operation")
            val fingerprintNode = request.deepCopy<ObjectNode>().also { it.remove(listOf("request_id", "project_id", "type")) }
            val fingerprint = BundleHasher.hashBytes(mapper.writeValueAsBytes(fingerprintNode))
            publisher.previous(operationId, fingerprint)?.let { return it }
            if (action == "purge_owner") {
                val changes = linkedMapOf<String, ByteArray?>()
                changes[revokedPath(owner)] = owner.toByteArray(Charsets.UTF_8)
                all().filter { it["ownerId"].asText() == owner }.forEach { draft ->
                    val dir = ProjectPathPolicy.resolve(root, draftPath(draft["id"].asText())).parentFile
                    dir.walkTopDown().filter { it.isFile }.forEach { changes[it.relativeTo(root).invariantSeparatorsPath] = null }
                }
                // Recovery reapplies the durable revocation before looking up this receipt.
                val result = publisher.commit(operationId, fingerprint, changes, response("ok" to true))
                publisher.forgetOwner(owner)
                return result
            }
            if (id == null) return fail("invalid_draft")
            if (action == "import") {
                val draft = request["draft"] ?: return fail("invalid_draft")
                if (!validEnvelope(draft) || draft["id"].asText() != id || draft["ownerId"].asText() != owner) return fail("invalid_draft")
                if (current != null && current != draft) return fail("draft_conflict")
                return publisher.commit(operationId, fingerprint, mapOf(draftPath(id) to mapper.writeValueAsBytes(draft)), response("ok" to true, "draft" to draft))
            }
            if (action == "create") {
                if (current != null) return fail("draft_conflict")
                val name = request["name"]?.asText() ?: return fail("invalid_draft")
                val snapshot = request["snapshot"] ?: return fail("invalid_draft")
                if (!validBody(name, snapshot)) return fail("invalid_draft")
                val now = Instant.now().toString()
                val draft = response("schema" to "artisan-draft/v1", "id" to id, "ownerId" to owner, "name" to name,
                    "revision" to 1, "status" to "active", "snapshot" to snapshot, "updatedBy" to owner,
                    "source" to (request["source"]?.asText() ?: "manual"), "createdAt" to now, "updatedAt" to now)
                val changes = linkedMapOf<String, ByteArray?>(draftPath(id) to mapper.writeValueAsBytes(draft))
                val ownDrafts = all().filter { it["ownerId"].asText() == owner }
                snapshot["binaryTree"]?.fields()?.forEach { (_, ref) ->
                    val hash = ref["hash"].asText()
                    val source = ownDrafts.asSequence().map { blob(it["id"].asText(), hash) }.firstOrNull { it.isFile }
                    if (source != null) {
                        val bytes = source.readBytes()
                        if (BundleHasher.hashBytes(bytes) != hash || bytes.size.toLong() != ref["size"].asLong()) return fail("invalid_blob")
                        changes[blob(id, hash).relativeTo(root).invariantSeparatorsPath] = bytes
                    }
                }
                return publisher.commit(operationId, fingerprint, changes, response("ok" to true, "draft" to draft))
            }
            if (current == null) return fail("not_found")
            if (current["status"].asText() != "active") return fail("draft_closed")
            if (!request.path("expected_revision").isIntegralNumber || request["expected_revision"].asLong() != current["revision"].asLong())
                return response("ok" to false, "error" to "draft_conflict", "draft" to current)
            if (action == "write_blob") {
                val hash = request["hash"]?.asText() ?: return fail("invalid_blob")
                val bytes = Base64.getDecoder().decode(request["content_base64"]?.asText() ?: return fail("invalid_blob"))
                if (bytes.size > 20 * 1024 * 1024 || BundleHasher.hashBytes(bytes) != hash) return fail("invalid_blob")
                val path = blob(id, hash).relativeTo(root).invariantSeparatorsPath
                return publisher.commit(operationId, fingerprint, mapOf(path to bytes), response("ok" to true, "draft" to current))
            }
            val draft = current.deepCopy<ObjectNode>()
            draft.put("revision", current["revision"].asLong() + 1)
            draft.put("updatedAt", Instant.now().toString())
            draft.put("updatedBy", owner)
            val changes = linkedMapOf<String, ByteArray?>()
            var wrote = 0
            when (action) {
                "update" -> {
                    val name = request["name"]?.asText() ?: return fail("invalid_draft")
                    val snapshot = request["snapshot"] ?: return fail("invalid_draft")
                    if (!validBody(name, snapshot)) return fail("invalid_draft")
                    draft.put("name", name)
                    draft.set<JsonNode>("snapshot", snapshot)
                }
                "discard" -> draft.put("status", "discarded")
                "publish" -> {
                    val planned = planPublish(id, current["snapshot"])
                    if (planned.error != null) return planned.error
                    wrote = planned.changes.size
                    changes.putAll(publisher.withHistory(planned.changes))
                    // Move document history with a rename, keeping source versions private.
                    current["snapshot"]["renames"]?.forEach { rename ->
                        val from = rename["from"].asText(); val to = rename["to"].asText()
                        val dir = ProjectPathPolicy.resolve(root, ".artisan/history/$from")
                        dir.listFiles()?.filter { it.isFile }?.forEach {
                            val dest = ".artisan/history/$to/${it.name}"
                            require(!ProjectPathPolicy.resolve(root, dest).exists()) { "history_conflict" }
                            changes[dest] = it.readBytes(); changes[".artisan/history/$from/${it.name}"] = null
                        }
                    }
                    draft.put("status", "published")
                }
                else -> return fail("invalid_action")
            }
            changes[draftPath(id)] = mapper.writeValueAsBytes(draft)
            return publisher.commit(operationId, fingerprint, changes, response("ok" to true, "draft" to draft, "wrote" to wrote))
        } catch (error: IllegalArgumentException) { return fail(error.message?.takeIf { it.matches(Regex("[a-z_]+")) } ?: "invalid_draft") }
    }

    private data class Plan(val changes: Map<String, ByteArray?>, val error: JsonNode? = null)
    private fun planPublish(id: String, snapshot: JsonNode): Plan {
        val baseline = snapshot["baseline"]; val tree = snapshot["tree"]
        val changes = linkedMapOf<String, ByteArray?>()
        val expected = linkedMapOf<String, String?>()
        (baseline.fieldNames().asSequence() + tree.fieldNames().asSequence()).toSet().forEach { path ->
            val before = baseline[path]?.asText(); val after = tree[path]?.asText()
            if (before != after) { changes[path] = after?.toByteArray(Charsets.UTF_8); expected[path] = before?.let { BundleHasher.hashContent(it) } }
        }
        val binaryBase = snapshot["binaryBaseline"]; val binaryTree = snapshot["binaryTree"]
        (binaryBase?.fieldNames()?.asSequence().orEmpty() + binaryTree?.fieldNames()?.asSequence().orEmpty()).toSet().forEach { path ->
            val before = binaryBase?.get(path)?.get("hash")?.asText(); val after = binaryTree?.get(path)?.get("hash")?.asText()
            if (before != after) {
                expected[path] = before
                changes[path] = if (after == null) null else {
                    val privateBlob = blob(id, after)
                    val target = ProjectPathPolicy.resolve(root, path)
                    val source = privateBlob.takeIf { it.isFile } ?: target.takeIf { it.isFile && BundleHasher.hashBytes(it.readBytes()) == after }
                        ?: return Plan(emptyMap(), fail("missing_blob"))
                    val bytes = source.readBytes()
                    if (bytes.size.toLong() != binaryTree!![path]["size"].asLong() || BundleHasher.hashBytes(bytes) != after) return Plan(emptyMap(), fail("invalid_blob"))
                    bytes
                }
            }
        }
        snapshot["renames"]?.forEach { rename ->
            val from = rename["from"].asText(); val to = rename["to"].asText()
            if (baseline[from] == null || tree[to] == null || tree[from] != null) return Plan(emptyMap(), fail("invalid_rename"))
            expected[from] = BundleHasher.hashContent(baseline[from].asText()); expected[to] = null
            changes[from] = null; changes[to] = tree[to].asText().toByteArray(Charsets.UTF_8)
        }
        val conflicts = expected.mapNotNull { (path, hash) ->
            val file = ProjectPathPolicy.resolve(root, path)
            val bytes = file.takeIf { it.isFile }?.readBytes()
            if (bytes?.let { BundleHasher.hashBytes(it) } == hash && !file.isDirectory) null
            else mapOf("path" to path, "disk" to bytes?.takeIf { !ProjectFilesReader.isBinary(path) }?.toString(Charsets.UTF_8), "disk_hash" to bytes?.let { BundleHasher.hashBytes(it) })
        }
        if (conflicts.isNotEmpty()) return Plan(emptyMap(), response("ok" to false, "error" to "conflict", "conflicts" to conflicts, "disk_files" to ProjectFilesReader.allPaths(root)))
        return Plan(changes)
    }

    private fun blob(id: String, hash: String): File {
        require(hash.matches(Regex("[a-f0-9]{64}"))) { "invalid_blob" }
        return ProjectPathPolicy.resolve(root, "${draftPath(id).substringBeforeLast('/')}/blobs/$hash")
    }
    private fun validEnvelope(draft: JsonNode): Boolean = draft.isObject && draft.path("schema").asText() == "artisan-draft/v1" &&
        !draft.has("projectId") && draft.path("id").isTextual && draft.path("ownerId").isTextual && draft.path("revision").isIntegralNumber && draft.path("revision").asLong() > 0 &&
        draft.path("status").asText() in setOf("active", "published", "discarded") && validBody(draft.path("name").asText(), draft.path("snapshot"))
    private fun contentPath(path: String) = ProjectPathPolicy.valid(path) && (!path.startsWith('.') || path == ".artisan/editor.yaml") && !ProjectPathPolicy.isPrivate(path)
    private fun validBody(name: String, snapshot: JsonNode): Boolean {
        fun tree(node: JsonNode?) = node != null && node.isObject && node.size() <= 5000 && node.fields().asSequence().all { contentPath(it.key) && it.value.isTextual }
        fun binary(node: JsonNode?) = node == null || node.isObject && node.size() <= 5000 && node.fields().asSequence().all {
            contentPath(it.key) && it.value.isObject && it.value.path("hash").asText().matches(Regex("[a-f0-9]{64}")) &&
                it.value.path("size").isIntegralNumber && it.value.path("size").asLong() in 0..20L * 1024 * 1024
        }
        if (name.isBlank() || name.length > 120 || !tree(snapshot["baseline"]) || !tree(snapshot["tree"]) ||
            snapshot.has("initialTree") && !tree(snapshot["initialTree"]) || !snapshot.path("at").isNumber || snapshot.path("at").asDouble() < 0 ||
            !binary(snapshot["binaryBaseline"]) || !binary(snapshot["binaryTree"]) || mapper.writeValueAsBytes(snapshot).size > 8 * 1024 * 1024) return false
        val textPaths = snapshot["baseline"].fieldNames().asSequence().toSet() + snapshot["tree"].fieldNames().asSequence().toSet()
        if ((snapshot["binaryBaseline"]?.fieldNames()?.asSequence().orEmpty() + snapshot["binaryTree"]?.fieldNames()?.asSequence().orEmpty()).any { it in textPaths }) return false
        val renames = snapshot["renames"] ?: return true
        if (!renames.isArray || renames.size() > 5000) return false
        val from = mutableSetOf<String>(); val to = mutableSetOf<String>()
        return renames.all { r -> r.path("from").isTextual && r.path("to").isTextual && contentPath(r["from"].asText()) && contentPath(r["to"].asText()) &&
            r["from"] != r["to"] && from.add(r["from"].asText()) && to.add(r["to"].asText()) }
    }
}
