package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.sync.ProjectFilesReader
import net.artisanmc.plugin.sync.BundleHasher
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch

class ProjectDraftChannelTest {
    @TempDir lateinit var root: File
    private val mapper = ObjectMapper()
    private fun snapshot(content: String = "new") = mapOf("baseline" to emptyMap<String, String>(), "tree" to mapOf("menus/a.yaml" to content), "at" to 1)
    private inner class Harness(onReload: (() -> Unit)? = null) {
        val roots = ProjectRoots(root)
        val replies = LinkedBlockingQueue<String>()
        val provider = SyncedMenuProvider(roots, null, onReload = onReload).also { p ->
            p.setSendForTesting { raw -> if (mapper.readTree(raw)["type"].asText() == "project_draft_result") replies.add(raw) }
        }
        fun request(action: String, owner: String = "alice", extra: Map<String, Any?> = emptyMap()) {
            provider.handleMessageForTesting(mapper.writeValueAsString(mapOf("type" to "project_draft_request", "request_id" to "r", "project_id" to "shop", "owner_id" to owner, "action" to action) + extra))
        }
        fun call(action: String, owner: String = "alice", extra: Map<String, Any?> = emptyMap()): com.fasterxml.jackson.databind.JsonNode {
            request(action, owner, extra)
            return mapper.readTree(replies.poll(5, TimeUnit.SECONDS) ?: throw AssertionError("missing draft response"))
        }
        fun create() = call("create", extra = mapOf("draft_id" to "d1", "operation_id" to "create", "name" to "Work", "snapshot" to snapshot()))
    }
    @Test fun `durable publication is acknowledged while runtime reload is still blocked`() {
        val project = File(root, "shop").also { it.mkdirs() }
        val reloading = CountDownLatch(1)
        val release = CountDownLatch(1)
        val h = Harness {
            reloading.countDown()
            release.await(5, TimeUnit.SECONDS)
        }
        h.create()
        h.request("publish", extra = mapOf("draft_id" to "d1", "operation_id" to "publish", "expected_revision" to 1))
        try {
            assertTrue(reloading.await(3, TimeUnit.SECONDS), "reload should run after publication")
            val raw = h.replies.poll(100, TimeUnit.MILLISECONDS)
            assertNotNull(raw, "durable writes must not wait for reload before acknowledgement")
            assertEquals("published", mapper.readTree(raw)["draft"]["status"].asText())
            assertEquals("new", File(project, "menus/a.yaml").readText())
        } finally {
            release.countDown()
        }
        assertEquals(0, h.call("list")["drafts"].size())
    }
    @Test fun `owner isolation revision CAS and idempotent lost acknowledgement`() {
        File(root, "shop").mkdirs()
        val h = Harness()
        assertEquals(1, h.create()["draft"]["revision"].asInt())
        assertEquals(1, h.create()["draft"]["revision"].asInt())
        assertEquals(0, h.call("list", "bob")["drafts"].size())
        assertEquals("not_found", h.call("read", "bob", mapOf("draft_id" to "d1"))["error"].asText())
        val update = mapOf("draft_id" to "d1", "operation_id" to "update", "expected_revision" to 1, "name" to "Work", "snapshot" to snapshot("next"))
        assertEquals(2, h.call("update", extra = update)["draft"]["revision"].asInt())
        assertEquals(2, h.call("update", extra = update)["draft"]["revision"].asInt())
        assertEquals("draft_conflict", h.call("update", extra = update + ("operation_id" to "stale"))["error"].asText())
        assertEquals("not_found", h.call("update", "bob", update)["error"].asText())
    }
    @Test fun `draft data is private and follows manual root rename`() {
        val project = File(root, "shop").also { it.mkdirs() }
        val h = Harness()
        h.create()
        File(project, ".artisan/editor.yaml").writeText("layout: []")
        assertEquals(setOf(".artisan/editor.yaml"), ProjectFilesReader.readAll(project).keys)
        assertEquals("", BundleHasher.hash(project))
        assertFalse(net.artisanmc.plugin.protocol.EditorPaths.isWritable(".artisan/drafts/d1/draft.json"))
        assertFalse(net.artisanmc.plugin.protocol.EditorPaths.isWritable(".artisan/transactions/op/intent.json"))
        assertTrue(project.renameTo(File(root, "renamed")))
        val envelope = mapper.readTree(File(root, "renamed/.artisan/drafts/d1/draft.json"))
        assertFalse(envelope.has("projectId"))
        assertEquals("alice", envelope["ownerId"].asText())
    }
    @Test fun `publish finalizes draft and exact binary bytes together and replay keeps result`() {
        val project = File(root, "shop").also { it.mkdirs() }
        val h = Harness()
        h.create()
        val bytes = byteArrayOf(-119, 80, 78, 71, 0, -1)
        val hash = BundleHasher.hashBytes(bytes)
        assertTrue(h.call("write_blob", extra = mapOf("draft_id" to "d1", "expected_revision" to 1, "operation_id" to "blob", "hash" to hash, "content_base64" to java.util.Base64.getEncoder().encodeToString(bytes)))["ok"].asBoolean())
        assertFalse(File(project, "assets/test.png").exists())
        val snap = snapshot() + mapOf("binaryBaseline" to emptyMap<String, Any>(), "binaryTree" to mapOf("assets/test.png" to mapOf("hash" to hash, "size" to bytes.size)))
        assertTrue(h.call("update", extra = mapOf("draft_id" to "d1", "operation_id" to "update", "expected_revision" to 1, "name" to "Work", "snapshot" to snap))["ok"].asBoolean())
        val publish = mapOf("draft_id" to "d1", "operation_id" to "publish", "expected_revision" to 2)
        assertEquals("published", h.call("publish", extra = publish)["draft"]["status"].asText())
        assertArrayEquals(bytes, File(project, "assets/test.png").readBytes())
        assertEquals("new", File(project, "menus/a.yaml").readText())
        assertEquals("published", Harness().call("publish", extra = publish)["draft"]["status"].asText())
        assertEquals(0, h.call("list")["drafts"].size())
        assertEquals(1, h.call("list_all", "")["drafts"].size())
    }

    @Test fun `migration preserves envelope and revocation prevents restoring an old owner`() {
        val project = File(root, "shop").also { it.mkdirs() }
        val h = Harness()
        val envelope = h.create()["draft"]
        val imported = h.call("import", extra = mapOf("operation_id" to "migration:d1", "draft" to envelope))
        assertEquals(envelope, imported["draft"])
        assertEquals(envelope, h.call("list_all", "")["drafts"][0])
        val purge = mapOf("operation_id" to "purge")
        assertTrue(h.call("purge_owner", extra = purge)["ok"].asBoolean())
        assertEquals("owner_revoked", h.call("read", extra = mapOf("draft_id" to "d1"))["error"].asText())
        File(project, ".artisan/drafts/d1/draft.json").also { it.parentFile.mkdirs() }.writeText(mapper.writeValueAsString(envelope))
        assertEquals(0, h.call("list_all", "")["drafts"].size())
        assertTrue(h.call("purge_owner", extra = purge)["ok"].asBoolean())
        assertFalse(File(project, ".artisan/drafts/d1/draft.json").exists())
        assertEquals("owner_revoked", h.create()["error"].asText())
        assertFalse(File(project, ".artisan/transactions").walkTopDown().filter { it.isFile }.any { it.readText().contains("\"ownerId\":\"alice\"") })
    }

    @Test fun `legacy HTTP draft identifiers import list and read without changing envelope IDs`() {
        File(root, "shop").mkdirs()
        val h = Harness()
        val original = h.create()["draft"]
        for (id in listOf("_legacy", "-legacy", "CON", "nul", "COM1")) {
            val draft = original.deepCopy<ObjectNode>().also { it.put("id", id) }
            val result = h.call("import", extra = mapOf("operation_id" to "migration:$id", "draft" to draft))
            assertEquals(draft, result["draft"], result.toString())
            assertEquals(draft, h.call("read", extra = mapOf("draft_id" to id))["draft"])
            assertTrue(h.call("list_all", "")["drafts"].any { it == draft })
        }
    }

    @Test fun `case distinct logical IDs stay independent for same and different owners`() {
        File(root, "shop").mkdirs()
        val h = Harness()
        val original = h.create()["draft"]
        for ((id, owner) in listOf("abc" to "alice", "ABC" to "alice", "other" to "alice", "OTHER" to "bob")) {
            val draft = original.deepCopy<ObjectNode>().also { it.put("id", id); it.put("ownerId", owner); it.put("updatedBy", owner) }
            assertEquals(draft, h.call("import", owner, mapOf("operation_id" to "migration:$id", "draft" to draft))["draft"])
        }
        for ((id, owner) in listOf("abc" to "alice", "ABC" to "alice", "other" to "alice", "OTHER" to "bob")) {
            val read = h.call("read", owner, mapOf("draft_id" to id))["draft"]
            assertEquals(id, read["id"].asText())
            assertEquals(owner, read["ownerId"].asText())
        }
        assertEquals(5, h.call("list_all", "")["drafts"].size())
    }

    @Test fun `publication conflict preserves active draft and every file`() {
        val project = File(root, "shop").also { it.mkdirs() }
        val h = Harness()
        h.create()
        File(project, "menus").mkdirs()
        File(project, "menus/a.yaml").writeText("external edit")
        val result = h.call("publish", extra = mapOf("draft_id" to "d1", "operation_id" to "publish", "expected_revision" to 1))
        assertEquals("conflict", result["error"].asText())
        assertEquals("external edit", File(project, "menus/a.yaml").readText())
        assertEquals("active", h.call("read", extra = mapOf("draft_id" to "d1"))["draft"]["status"].asText())
    }

    @Test fun `copying a draft carries private binary blobs only for its owner`() {
        File(root, "shop").mkdirs()
        val h = Harness()
        h.create()
        val bytes = byteArrayOf(-1, 0, -127)
        val hash = BundleHasher.hashBytes(bytes)
        h.call("write_blob", extra = mapOf("draft_id" to "d1", "operation_id" to "blob", "expected_revision" to 1, "hash" to hash, "content_base64" to java.util.Base64.getEncoder().encodeToString(bytes)))
        val snap = snapshot() + mapOf("binaryBaseline" to emptyMap<String, Any>(), "binaryTree" to mapOf("assets/a.png" to mapOf("hash" to hash, "size" to bytes.size)))
        for ((owner, id) in listOf("bob" to "other", "alice" to "copy")) {
            val create = h.call("create", owner, mapOf("draft_id" to id, "operation_id" to "create-$id", "name" to "Copy", "snapshot" to snap))
            assertTrue(create["ok"].asBoolean())
            val publish = h.call("publish", owner, mapOf("draft_id" to id, "operation_id" to "publish-$id", "expected_revision" to 1))
            if (owner == "bob") assertEquals("missing_blob", publish["error"].asText())
            else assertEquals("published", publish["draft"]["status"].asText())
        }
        assertArrayEquals(bytes, File(root, "shop/assets/a.png").readBytes())
    }
}
