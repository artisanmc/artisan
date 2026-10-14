package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader
import java.io.File
import java.util.Base64

/**
 * Publishes a Draft the hub keeps in the suite database (ADR `server-identity-and-versions`): the
 * message carries the draft and the bytes of its new binaries. Every changed file is checked against
 * the disk (compare-and-swap), then all are written at once with the operation's receipt, so a
 * publication replayed after a lost answer returns its first result.
 */
class DraftPublication(private val root: File) {
    private val mapper = ObjectMapper()
    private val publisher = ProjectPublisher(root)

    private fun response(vararg values: Pair<String, Any?>): JsonNode = mapper.valueToTree(mapOf(*values))
    private fun fail(error: String) = response("ok" to false, "error" to error)

    fun publish(message: JsonNode): JsonNode {
        publisher.recover()
        val operationId = message.path("operation_id").asText().takeIf { it.length in 1..256 } ?: return fail("invalid_operation")
        val fingerprint = BundleHasher.hashBytes(mapper.writeValueAsBytes((message.deepCopy() as ObjectNode).also { it.remove(listOf("request_id", "type")) }))
        publisher.previous(operationId, fingerprint)?.let { return it }
        val snapshot = message.path("draft").path("snapshot").takeIf { it.isObject } ?: return fail("invalid_draft")
        val blobs = message.path("blobs").fields().asSequence().associate { (hash, base64) -> hash to Base64.getDecoder().decode(base64.asText()) }
        return try {
            val (changes, error) = plan(snapshot, blobs)
            error ?: publisher.commit(operationId, fingerprint, changes, response("ok" to true, "wrote" to changes.size))
        } catch (e: IllegalArgumentException) {
            fail(e.message?.takeIf { it.matches(Regex("[a-z_]+")) } ?: "invalid_draft")
        }
    }

    private fun plan(snapshot: JsonNode, blobs: Map<String, ByteArray>): Pair<Map<String, ByteArray?>, JsonNode?> {
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
                    val target = ProjectPathPolicy.resolve(root, path)
                    val bytes = blobs[after] ?: target.takeIf { it.isFile }?.readBytes()?.takeIf { BundleHasher.hashBytes(it) == after }
                        ?: return emptyMap<String, ByteArray?>() to fail("missing_blob")
                    if (bytes.size.toLong() != binaryTree!![path]["size"].asLong() || BundleHasher.hashBytes(bytes) != after) return emptyMap<String, ByteArray?>() to fail("invalid_blob")
                    bytes
                }
            }
        }
        snapshot["renames"]?.forEach { rename ->
            val from = rename["from"].asText(); val to = rename["to"].asText()
            if (baseline[from] == null || tree[to] == null || tree[from] != null) return emptyMap<String, ByteArray?>() to fail("invalid_rename")
            expected[from] = BundleHasher.hashContent(baseline[from].asText()); expected[to] = null
            changes[from] = null; changes[to] = tree[to].asText().toByteArray(Charsets.UTF_8)
        }
        val conflicts = expected.mapNotNull { (path, hash) ->
            val file = ProjectPathPolicy.resolve(root, path)
            val bytes = file.takeIf { it.isFile }?.readBytes()
            if (bytes?.let { BundleHasher.hashBytes(it) } == hash && !file.isDirectory) null
            else mapOf("path" to path, "disk" to bytes?.takeIf { !ProjectFilesReader.isBinary(path) }?.toString(Charsets.UTF_8), "disk_hash" to bytes?.let { BundleHasher.hashBytes(it) })
        }
        if (conflicts.isNotEmpty()) return emptyMap<String, ByteArray?>() to response("ok" to false, "error" to "conflict", "conflicts" to conflicts, "disk_files" to ProjectFilesReader.allPaths(root))
        return changes to null
    }
}
