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
    private val case = ObjectMapper().readTree(File("../testdata/resource-pack-conformance.json"))["cases"]
        .first { it["name"].asText().startsWith("glyph title layers across two projects") }

    /** The case's Projects as server `u-local` loaded them, read from the database. */
    private val loaded = object : LoadedProjects {
        private val projects = case["projects"].associateBy { it["id"].asText() }
        override fun list(server: String) = if (server != "u-local") null else mapOf("project_ids" to projects.keys.toList())
        override fun read(server: String, folder: String): Map<String, Any?>? {
            val p = projects[folder] ?: return null
            return mapOf(
                "hash" to "h",
                "files" to p["files"].fields().asSequence().map { (path, c) -> mapOf("path" to path, "content" to c.asText()) }.toList(),
                "binaries" to p["binaries"].fieldNames().asSequence().map { mapOf("path" to it, "hash" to "x", "size" to 1) }.toList(),
            )
        }
        override fun binary(server: String, folder: String, path: String): ByteArray? =
            projects[folder]?.get("binaries")?.get(path)?.let { Base64.getDecoder().decode(it.asText()) }
    }

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
}
