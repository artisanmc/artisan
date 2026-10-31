package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.util.Base64
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PackBuilderTest {
    private val cases = ObjectMapper().readTree(File("../testdata/resource-pack-conformance.json"))["cases"]
    private fun case(name: String) = cases.first { it["name"].asText().startsWith(name) }
    private val case = case("glyph title layers across two projects")

    /**
     * A case's Projects as server `u-local` loaded them, read from the database; their module images
     * (`overlayImages`) as the server records them at load (`pack_images`).
     */
    private fun loadedOf(case: com.fasterxml.jackson.databind.JsonNode) = object : LoadedProjects {
        private val projects = case["projects"].associateBy { it["id"].asText() }
        override fun list(server: String) = if (server != "u-local") null else mapOf("project_ids" to projects.keys.toList())
        override fun read(server: String, folder: String): Map<String, Any?>? {
            val p = projects[folder] ?: return null
            return mapOf(
                "hash" to "h",
                "files" to p["files"].fields().asSequence().map { (path, c) -> mapOf("path" to path, "content" to c.asText()) }.toList(),
                "binaries" to p["binaries"].fieldNames().asSequence().map { mapOf("path" to it, "hash" to "x", "size" to 1) }.toList(),
                "pack_images" to (p["overlayImages"]?.let { ObjectMapper().convertValue(it, List::class.java) } ?: emptyList<Any>()),
            )
        }
        override fun binary(server: String, folder: String, path: String): ByteArray? =
            projects[folder]?.get("binaries")?.get(path)?.let { Base64.getDecoder().decode(it.asText()) }
    }

    private val loaded = loadedOf(case)

    private val servers = Servers(McpFixtures.server(mutableListOf()))

    /** Runs each task at once, on the caller's thread. */
    private val direct = object : AbstractExecutorService() {
        override fun execute(command: Runnable) = command.run()
        override fun shutdown() = Unit
        override fun shutdownNow() = emptyList<Runnable>()
        override fun isShutdown() = false
        override fun isTerminated() = false
        override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
    }

    private val warnings = mutableListOf<String>()
    private val logger = Logger.getAnonymousLogger().apply {
        useParentHandlers = false
        addHandler(object : Handler() {
            override fun publish(record: LogRecord) { if (record.level == Level.WARNING) warnings += record.message }
            override fun flush() = Unit
            override fun close() = Unit
        })
    }

    @Test
    fun `builds the editor's bytes from what the server loaded`() {
        // The editor anchors assets to `<server>.<folder>`, as the hub does: same order, same pack.
        assertEquals(case["sha1"].asText(), PackBuilder(servers, loaded, logger, direct).build("u-local")?.sha1)
    }

    @Test
    fun `builds the module images the server recorded at load`() {
        val images = case("module images at a height")
        assertEquals(images["sha1"].asText(), PackBuilder(servers, loadedOf(images), logger, direct).build("u-local")?.sha1)
    }

    @Test
    fun `an unknown server or one without a state builds nothing`() {
        val builder = PackBuilder(servers, loaded, logger, direct)
        assertNull(builder.build("u-other"))
    }

    @Test
    fun `shadow mode compares with the editor's upload without warning when they match`() {
        val builder = PackBuilder(servers, loaded, logger, direct)
        assertEquals(case["sha1"].asText(), builder.request("u-local").get()?.hubHash)
        builder.editorUploaded("u-local", case["sha1"].asText())
        assertEquals(true, builder.status("u-local")?.matches)
        assertTrue(warnings.isEmpty(), warnings.toString())

        builder.editorUploaded("u-local", "0".repeat(40))
        assertEquals(false, builder.status("u-local")?.matches)
        assertEquals(1, warnings.size)
    }

    @Test
    fun `requests made while one waits share its build and its result`() {
        val queue = java.util.concurrent.LinkedBlockingQueue<Runnable>()
        val held = object : AbstractExecutorService() {
            override fun execute(command: Runnable) { queue += command }
            override fun shutdown() = Unit
            override fun shutdownNow() = emptyList<Runnable>()
            override fun isShutdown() = false
            override fun isTerminated() = false
            override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
        }
        val builder = PackBuilder(servers, loaded, logger, held)
        val first = builder.request("u-local")
        val second = builder.request("u-local")
        assertEquals(1, queue.size)
        queue.poll().run()
        assertEquals(case["sha1"].asText(), first.get()?.hubHash)
        assertTrue(first === second)
        // Once that build ran, a new request queues a new one.
        builder.request("u-local")
        assertEquals(1, queue.size)
    }

    @Test
    fun `a binary missing from the database fails the build and keeps the last status`() {
        val lossy = object : LoadedProjects by loaded {
            override fun binary(server: String, folder: String, path: String): ByteArray? = null
        }
        val builder = PackBuilder(servers, lossy, logger, direct)
        builder.request("u-local")
        assertNull(builder.status("u-local")?.hubHash)
        assertTrue(builder.status("u-local")?.error.orEmpty().startsWith("binary_missing:"))
        assertEquals(1, warnings.size)
    }

    @Test
    fun `an AI app allowed to deploy rebuilds the pack and reads its status`() {
        val builder = PackBuilder(servers, loaded, logger, direct)
        val tools = McpTools(McpProjects(servers), packs = builder)
        val mapper = ObjectMapper()
        fun call(principal: McpPrincipal, name: String, vararg args: Pair<String, Any?>): McpTools.Outcome =
            tools.invoke(principal, tools.find(name)!!, mapper.valueToTree(args.toMap()))
        val deployer = McpPrincipal(java.util.UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet())
        val draftsOnly = McpPrincipal(java.util.UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet(), deploys = false)

        assertEquals(listOf("resource_pack_status"), tools.available(draftsOnly).map { it.name }.filter { it.startsWith("resource_pack") })
        val before = call(draftsOnly, "resource_pack_status", "server" to "u-local").body as Map<*, *>
        assertEquals(false, before["built"])

        val rebuilt = call(deployer, "resource_pack_rebuild", "server" to "u-local").body as Map<*, *>
        assertEquals(true, rebuilt["done"])
        assertEquals(case["sha1"].asText(), rebuilt["hub_sha1"])
        assertEquals("shadow", rebuilt["mode"])
        assertTrue(call(draftsOnly, "resource_pack_rebuild", "server" to "u-local").error, "deploying is the player's call")
        assertEquals("unknown_server", (call(deployer, "resource_pack_status", "server" to "nope").body as Map<*, *>)["error"])

        // The free jar has no hub build: no pack tools.
        assertTrue(McpTools(McpProjects(servers)).tools.none { it.name.startsWith("resource_pack") })
    }
}
