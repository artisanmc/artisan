package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectCopier
import net.artisanmc.plugin.sync.BundleHasher
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.Base64

class ProjectCopyTest {
    @TempDir lateinit var root: File
    private val mapper = ObjectMapper()
    private val files = linkedMapOf("manifest.yaml" to "name: café\n".toByteArray(), "assets/a.png" to byteArrayOf(-119,80,78,71,0,-1), "assets/a.ttf" to byteArrayOf(0,1,0,-1), ".artisan/editor.yaml" to "zoom: 2".toByteArray(), "lang/français.yaml" to byteArrayOf())
    private fun begin(target: String = "copy") = linkedMapOf<String, Any>("action" to "begin", "operation_id" to "op1", "target_id" to target, "minecraft_version" to "1.21.4", "modules" to emptyList<String>(), "files" to files.toSortedMap().map { (path, data) -> linkedMapOf("path" to path, "size" to data.size, "sha256" to BundleHasher.hashBytes(data)) }).also { request ->
        request["fingerprint"] = BundleHasher.hashBytes(mapper.writeValueAsBytes(linkedMapOf("target_id" to target, "minecraft_version" to "1.21.4", "modules" to emptyList<String>(), "files" to request["files"])))
    }
    private fun send(c: ProjectCopier, request: Map<String, Any>) = c.handle(mapper.valueToTree(request), "1.21.4", emptySet())
    private fun upload(c: ProjectCopier, request: Map<String, Any>) {
        files.forEach { (path, bytes) ->
            val chunk = request + mapOf("action" to "chunk", "path" to path, "offset" to 0, "content_base64" to Base64.getEncoder().encodeToString(bytes))
            assertEquals(true, send(c, chunk)["ok"])
            assertEquals(true, send(c, chunk)["ok"])
        }
    }
    @Test fun `complete byte exact copy stays invisible until commit and receipts survive restart`() {
        val roots = ProjectRoots(root); val c = roots.copier; val request = begin()
        assertEquals(true, send(c, request)["ok"]); upload(c, request)
        assertTrue(roots.all().isEmpty()); assertFalse(File(root,"copy").exists())
        assertEquals("activated", send(c, request + ("action" to "commit"))["state"])
        files.forEach { (path, bytes) -> assertArrayEquals(bytes, File(root,"copy/$path").readBytes()) }
        val restarted = ProjectRoots(root)
        assertEquals("activated", send(restarted.copier, request + ("action" to "status"))["state"])
        assertEquals("activated", send(restarted.copier, request)["state"])
        assertEquals(setOf("copy"), restarted.all().keys)
    }
    @Test fun `occupied destination and changed operation cannot overwrite`() {
        File(root,"copy").mkdirs(); val c = ProjectRoots(root).copier
        assertEquals("destination_exists", send(c, begin())["error"])
        val request = begin("fresh"); assertEquals(true, send(c, request)["ok"])
        assertEquals("operation_conflict", send(c, begin("other"))["error"])
    }
    @Test fun `incomplete and corrupt uploads never become runtime projects`() {
        val roots = ProjectRoots(root); val request = begin(); val c = roots.copier
        send(c, request)
        assertEquals("incomplete", send(c, request + ("action" to "commit"))["error"])
        upload(c,request)
        val bad = request + mapOf("action" to "chunk", "path" to "assets/a.png", "offset" to 0, "content_base64" to "AAAA")
        assertEquals("chunk_conflict",send(c,bad)["error"])
        assertTrue(ProjectRoots(root).all().isEmpty())
    }
    @Test fun `crash after activation recovers ownership receipt`() {
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        roots.copier.afterActivationForTesting = { throw IllegalStateException("crash") }
        assertEquals(false,send(roots.copier,request + ("action" to "commit"))["ok"])
        val restarted = ProjectRoots(root)
        assertEquals("activated",send(restarted.copier,request + ("action" to "status"))["state"])
        assertEquals(setOf("copy"),restarted.all().keys)
    }
    @Test fun `activated receipt clears leftover owned marker after restart without reverting edits`() {
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        assertEquals("activated",send(roots.copier,request + ("action" to "commit"))["state"])
        // Durable state at a crash between receipt persistence and marker deletion.
        val marker = File(root,"copy/.artisan/copy-operation.json"); marker.writeText("op1")
        File(root,"copy/manifest.yaml").writeText("name: edited\n")
        val restarted = ProjectRoots(root)
        assertEquals(setOf("copy"),restarted.all().keys)
        assertFalse(marker.exists())
        assertEquals("activated",send(restarted.copier,request + ("action" to "status"))["state"])
        assertEquals("name: edited\n",File(root,"copy/manifest.yaml").readText())
    }
    @Test fun `activated receipt never clears a marker owned by another operation`() {
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        send(roots.copier,request + ("action" to "commit"))
        val marker = File(root,"copy/.artisan/copy-operation.json"); marker.writeText("different")
        assertTrue(ProjectRoots(root).all().isEmpty())
        assertEquals("different",marker.readText())
    }
    @Test fun `chunks require contiguous offsets and accept exact previous ranges after restart`() {
        val c = ProjectRoots(root).copier; val request = begin(); send(c,request)
        fun chunk(offset: Int, data: ByteArray) = request + mapOf("action" to "chunk", "path" to "assets/a.png", "offset" to offset, "content_base64" to Base64.getEncoder().encodeToString(data))
        val bytes = files.getValue("assets/a.png")
        assertEquals("invalid_offset",send(c,chunk(3,bytes.copyOfRange(3,6)))["error"])
        assertEquals(true,send(c,chunk(0,bytes.copyOfRange(0,3)))["ok"])
        val restarted = ProjectRoots(root).copier
        assertEquals(true,send(restarted,chunk(3,bytes.copyOfRange(3,6)))["ok"])
        assertEquals(true,send(restarted,chunk(0,bytes.copyOfRange(0,3)))["ok"])
        upload(restarted,request)
        assertEquals("activated",send(restarted,request + ("action" to "commit"))["state"])
    }
    @Test fun `invalid UTF8 and wrong checksums cannot activate`() {
        files["bad.yaml"] = byteArrayOf(-1)
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        assertEquals("invalid_utf8",send(roots.copier,request + ("action" to "commit"))["error"])
        assertTrue(roots.all().isEmpty())
        File(root,".artisan-copies/${BundleHasher.hashContent("op1")}.tree/bad.yaml").writeBytes(byteArrayOf(1))
        assertEquals("hash_mismatch",send(roots.copier,request + ("action" to "commit"))["error"])
    }
    @Test fun `private paths and addon destinations are rejected`() {
        val roots = ProjectRoots(root); roots.register("copy",File(root,"external"))
        assertEquals("destination_exists",send(roots.copier,begin())["error"])
        files[".artisan/drafts/secret.yaml"] = "secret".toByteArray()
        assertEquals("invalid_path",send(roots.copier,begin("other"))["error"])
    }
    @Test fun `websocket handler dispatches file operations off callback thread`() {
        val callback = Thread.currentThread().id
        val replies = java.util.concurrent.LinkedBlockingQueue<Pair<Long, com.fasterxml.jackson.databind.JsonNode>>()
        val provider = net.artisanmc.plugin.provider.SyncedMenuProvider(ProjectRoots(root), "", "", null)
        provider.setSendForTesting { raw -> replies.add(Thread.currentThread().id to mapper.readTree(raw)) }
        provider.handleMessageForTesting(mapper.writeValueAsString(begin() + mapOf("type" to "project_copy", "request_id" to "r1")))
        val reply = replies.poll(5,java.util.concurrent.TimeUnit.SECONDS)
        assertNotNull(reply); assertNotEquals(callback,reply.first)
        assertEquals("project_copy_result",reply.second["type"].asText()); assertTrue(reply.second["ok"].asBoolean())
    }
    @Test fun `inactive staging expires without polling renewal and permanent receipts survive`() {
        var time = 0L
        val c = ProjectCopier(ProjectRoots(root),ProjectCopier.Limits(pending=1,stagingTtlMillis=100),now = { time })
        val request = begin(); send(c,request); upload(c,request)
        time = 99; assertEquals("staging",send(c,request + ("action" to "status"))["state"])
        time = 100; assertEquals("operation_expired",send(c,request + ("action" to "commit"))["error"])
        assertFalse(File(root,".artisan-copies/${BundleHasher.hashContent("op1")}.tree").exists()); assertFalse(File(root,"copy").exists())
        val next = begin() + ("operation_id" to "op2")
        assertEquals(true,send(c,next)["ok"]); upload(c,next)
        assertEquals("activated",send(c,next + ("action" to "commit"))["state"])
        time = 10000
        assertEquals("activated",send(c,next + ("action" to "status"))["state"])
        assertEquals("operation_expired",send(c,request)["error"])
    }
    @Test fun `operation names differing only by case retain separate receipts`() {
        val c = ProjectRoots(root).copier
        val a = begin("one") + ("operation_id" to "ABC")
        val b = begin("two") + ("operation_id" to "abc")
        assertEquals(true,send(c,a)["ok"]); assertEquals(true,send(c,b)["ok"])
        val restarted = ProjectRoots(root).copier
        assertEquals("staging",send(restarted,a + ("action" to "status"))["state"])
        assertEquals("staging",send(restarted,b + ("action" to "status"))["state"])
    }
    @Test fun `broken receipt isolates known target while healthy projects remain discoverable`() {
        File(root,"healthy").mkdirs(); File(root,"broken").mkdirs()
        File(root,".artisan-copies").mkdirs()
        File(root,".artisan-copies/broken.json").writeText("{\"target_id\":\"broken\",BROKEN")
        assertEquals(setOf("healthy"),ProjectRoots(root).all().keys)
    }
    @Test fun `unexpected staging files block activation`() {
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        File(root,".artisan-copies/${BundleHasher.hashContent("op1")}.tree/extra.yaml").writeText("extra")
        assertEquals("manifest_mismatch",send(roots.copier,request + ("action" to "commit"))["error"])
        assertTrue(roots.all().isEmpty())
    }
    @Test fun `unconfirmed activated directory stays isolated when receipt is unreadable`() {
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        roots.copier.afterActivationForTesting = { error("crash") }
        send(roots.copier,request + ("action" to "commit"))
        File(root,".artisan-copies/${BundleHasher.hashContent("op1")}.json").writeText("unreadable")
        File(root,"healthy").mkdirs()
        assertEquals(setOf("healthy"),ProjectRoots(root).all().keys)
    }
    @Test fun `retry completes a matching partial chunk left by interrupted write`() {
        files["assets/large.png"] = ByteArray(192 * 1024) { (it % 251).toByte() }
        val roots = ProjectRoots(root); val request = begin(); send(roots.copier,request); upload(roots.copier,request)
        val partial = File(root,".artisan-copies/${BundleHasher.hashContent("op1")}.tree/assets/large.png")
        java.io.RandomAccessFile(partial,"rw").use { it.setLength(41337); it.fd.sync() }
        val restarted = ProjectRoots(root).copier
        upload(restarted,request)
        assertEquals("activated",send(restarted,request + ("action" to "commit"))["state"])
        assertArrayEquals(files.getValue("assets/large.png"),File(root,"copy/assets/large.png").readBytes())
    }
    @Test fun `receipt queries do not repeat runtime reload and failed reload hook still replies`() {
        var reloads = 0
        val responses = java.util.concurrent.LinkedBlockingQueue<com.fasterxml.jackson.databind.JsonNode>()
        val provider = net.artisanmc.plugin.provider.SyncedMenuProvider(ProjectRoots(root),"","",null,onReload = { reloads++; error("runtime hook failed") })
        provider.setSendForTesting { raw -> mapper.readTree(raw).takeIf { it.path("type").asText() == "project_copy_result" }?.let { responses.add(it) } }
        fun exchange(request: Map<String,Any>): com.fasterxml.jackson.databind.JsonNode {
            provider.handleMessageForTesting(mapper.writeValueAsString(request + mapOf("type" to "project_copy", "request_id" to "r1")))
            return responses.poll(5,java.util.concurrent.TimeUnit.SECONDS) ?: error("no receipt")
        }
        val request = begin(); assertTrue(exchange(request)["ok"].asBoolean())
        files.forEach { (path, bytes) -> assertTrue(exchange(request + mapOf("action" to "chunk","path" to path,"offset" to 0,"content_base64" to Base64.getEncoder().encodeToString(bytes)))["ok"].asBoolean()) }
        assertEquals("activated",exchange(request + ("action" to "commit"))["state"].asText())
        assertEquals("activated",exchange(request + ("action" to "status"))["state"].asText())
        assertEquals("activated",exchange(request)["state"].asText())
        assertEquals("activated",exchange(request + ("action" to "commit"))["state"].asText())
        assertEquals(1,reloads)
    }
}
