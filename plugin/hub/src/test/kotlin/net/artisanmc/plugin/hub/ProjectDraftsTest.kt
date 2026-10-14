package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.sync.BundleHasher
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProjectDraftsTest {
    private class Memory : DraftStorage {
        val rows = linkedMapOf<String, String>()
        val receipts = mutableMapOf<String, Pair<String, String>>()
        val contents = mutableMapOf<String, ByteArray>()
        var failCommits = false
        /** The next commit finds its receipt written by a concurrent, identical request. */
        var raceOnce = false
        override fun knownProject(server: String, folder: String) = folder != "missing"
        override fun drafts(server: String, folder: String) = if (folder == "missing") null else rows.filterKeys { it.startsWith("$server/$folder/") }.values.toList()
        override fun draft(server: String, folder: String, id: String) = rows["$server/$folder/$id"]
        override fun receipt(operationId: String) = receipts[operationId]
        override fun commit(server: String, folder: String, id: String, draft: String, status: String, operationId: String, fingerprint: String, result: String): Boolean {
            if (failCommits) throw java.sql.SQLException("connection lost")
            if (raceOnce) { raceOnce = false; rows["$server/$folder/$id"] = draft; receipts[operationId] = fingerprint to result }
            if (operationId in receipts) throw java.sql.SQLException("Duplicate entry for key artisan_draft_receipts.PRIMARY")
            rows["$server/$folder/$id"] = draft
            receipts[operationId] = fingerprint to result
            return true
        }
        override fun content(hash: String) = contents[hash]
        override fun putContent(hash: String, bytes: ByteArray) { contents[hash] = bytes }
    }

    private val storage = Memory()
    private val drafts = ProjectDrafts(storage)
    private val sentToServer = mutableListOf<Map<String, Any?>>()
    private var serverReply: (Map<String, Any?>) -> Map<String, Any?> = { mapOf("ok" to true, "wrote" to 1) }
    private val publisher = ProjectDrafts.Publisher { message, reply -> sentToServer += message; reply(serverReply(message)) }

    private fun request(vararg fields: Pair<String, Any?>): Map<String, Any?> {
        var out: Map<String, Any?> = emptyMap()
        drafts.handle("local", "shop", Call.mapper.valueToTree<ObjectNode>(mapOf("owner_id" to "alice") + fields), publisher) { out = it }
        return out
    }

    private fun snapshot(tree: Map<String, String>, binaries: Map<String, Map<String, Any>> = emptyMap()) =
        mapOf("baseline" to mapOf("a.yml" to "a: 0"), "tree" to tree, "at" to 1, "binaryBaseline" to emptyMap<String, Any>(), "binaryTree" to binaries)

    private fun create(id: String = "d1") =
        request("action" to "create", "draft_id" to id, "operation_id" to "op-c-$id", "name" to "Brouillon", "snapshot" to snapshot(mapOf("a.yml" to "a: 1")))

    @Suppress("UNCHECKED_CAST")
    private fun draftOf(result: Map<String, Any?>) = Call.mapper.convertValue(result["draft"], Map::class.java) as Map<String, Any?>

    @Test
    fun `a draft is created, updated by revision and listed for its owner only`() {
        assertEquals(1, (draftOf(create())["revision"] as Number).toInt())
        val updated = request("action" to "update", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-u", "name" to "B", "snapshot" to snapshot(mapOf("a.yml" to "a: 2")))
        assertEquals(2, (draftOf(updated)["revision"] as Number).toInt())
        val stale = request("action" to "update", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-u2", "name" to "B", "snapshot" to snapshot(mapOf("a.yml" to "a: 3")))
        assertEquals("draft_conflict", stale["error"])
        assertEquals(1, (request("action" to "list")["drafts"] as List<*>).size)
        var other: Map<String, Any?> = emptyMap()
        drafts.handle("local", "shop", Call.mapper.valueToTree(mapOf("owner_id" to "bob", "action" to "read", "draft_id" to "d1")), publisher) { other = it }
        assertEquals("draft_not_found", other["error"])
    }

    @Test
    fun `a replayed operation gives back its result, a reused id with other content is refused`() {
        val first = create()
        val replayed = create()
        assertEquals(draftOf(first)["createdAt"], draftOf(replayed)["createdAt"])
        assertEquals(draftOf(first)["snapshot"], draftOf(replayed)["snapshot"])
        val reused = request("action" to "create", "draft_id" to "d2", "operation_id" to "op-c-d1", "name" to "X", "snapshot" to snapshot(mapOf("a.yml" to "x")))
        assertEquals("operation_conflict", reused["error"])
    }

    @Test
    fun `a receipt keeps the result without the draft's body`() {
        create()
        val (_, result) = storage.receipts.getValue("op-c-d1")
        assertEquals(mapOf("ok" to true, "draft" to mapOf("revision" to 1)), Call.mapper.readValue(result, Map::class.java))
    }

    @Test
    fun `a commit that lost the race to the same operation answers with its receipt`() {
        create()
        storage.raceOnce = true
        val updated = request("action" to "update", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-u", "name" to "B", "snapshot" to snapshot(mapOf("a.yml" to "a: 2")))
        assertEquals(true, updated["ok"])
        assertEquals(2, (draftOf(updated)["revision"] as Number).toInt())
        assertEquals("B", draftOf(updated)["name"])
        assertEquals("operation_conflict", request("action" to "update", "draft_id" to "d1", "expected_revision" to 2, "operation_id" to "op-u", "name" to "C", "snapshot" to snapshot(mapOf("a.yml" to "a: 3")))["error"])
    }

    @Test
    fun `a failing database is storage_error, a missing draft is draft_not_found`() {
        create()
        storage.failCommits = true
        val failed = request("action" to "update", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-u", "name" to "B", "snapshot" to snapshot(mapOf("a.yml" to "a: 2")))
        assertEquals("storage_error", failed["error"])
        storage.failCommits = false
        assertEquals("draft_not_found", request("action" to "read", "draft_id" to "nope")["error"])
        assertEquals("draft_not_found", request("action" to "update", "draft_id" to "nope", "expected_revision" to 1, "operation_id" to "op-n", "name" to "B", "snapshot" to snapshot(mapOf("a.yml" to "a: 2")))["error"])
        request("action" to "discard", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-d")
        assertEquals("draft_closed", request("action" to "update", "draft_id" to "d1", "expected_revision" to 2, "operation_id" to "op-u2", "name" to "B", "snapshot" to snapshot(mapOf("a.yml" to "a: 2")))["error"])
    }

    @Test
    fun `publishing sends the draft and its new blobs, then closes the draft`() {
        create()
        val png = byteArrayOf(1, 2, 3)
        val hash = BundleHasher.hashBytes(png)
        request("action" to "write_blob", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-b", "hash" to hash, "content_base64" to Base64.getEncoder().encodeToString(png))
        request(
            "action" to "update", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-u", "name" to "B",
            "snapshot" to snapshot(mapOf("a.yml" to "a: 1"), mapOf("logo.png" to mapOf("hash" to hash, "size" to 3))),
        )
        val published = request("action" to "publish", "draft_id" to "d1", "expected_revision" to 2, "operation_id" to "op-p", "author_id" to "u1", "author_name" to "Alice")
        assertEquals(true, published["ok"])
        assertEquals("published", draftOf(published)["status"])
        val sent = sentToServer.single()
        assertEquals("project_draft_publish", sent["type"])
        assertEquals(mapOf(hash to Base64.getEncoder().encodeToString(png)), sent["blobs"])
        assertEquals("Alice", sent["author_name"])
        assertTrue((request("action" to "list")["drafts"] as List<*>).isEmpty())
    }

    @Test
    fun `a refused publication leaves the draft active`() {
        create()
        serverReply = { mapOf("ok" to false, "error" to "conflict", "conflicts" to listOf(mapOf("path" to "a.yml"))) }
        val refused = request("action" to "publish", "draft_id" to "d1", "expected_revision" to 1, "operation_id" to "op-p")
        assertEquals("conflict", refused["error"])
        assertEquals("active", draftOf(request("action" to "read", "draft_id" to "d1"))["status"])
        assertNull(storage.receipts["op-p"])
    }

    @Test
    fun `an unknown project and an invalid snapshot are refused`() {
        var out: Map<String, Any?> = emptyMap()
        drafts.handle("local", "missing", Call.mapper.valueToTree(mapOf("owner_id" to "alice", "action" to "list")), publisher) { out = it }
        assertEquals("unknown_project", out["error"])
        assertEquals("invalid_draft", request("action" to "create", "draft_id" to "d1", "operation_id" to "op", "name" to "", "snapshot" to snapshot(emptyMap()))["error"])
    }
}
