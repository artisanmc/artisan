package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** WS live channel of the module Config screens (ADR module-config-screens). */
class ConfigChannelTest {
    private val mapper = ObjectMapper()

    private class Harness {
        val root: File = Files.createTempDirectory("artisan_cfg_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        var latch: CountDownLatch = CountDownLatch(1)
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(root),
            logger = null,
        )
        init {
            provider.setSendForTesting { raw ->
                @Suppress("UNCHECKED_CAST")
                sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
                latch.countDown()
            }
        }
        /** Waits for THE REPLY: reload announcements travel on the same
         *  connection and may arrive before it. */
        fun await(replies: Int = 1) {
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                if (sink.count { it["type"] != "projects_reloaded" } >= replies) return
                Thread.sleep(10)
            }
            throw AssertionError("expected $replies reply(ies), got ${sink.size} message(s)")
        }
        /** The expected reply, ignoring the reload announcements travelling on
         *  the same connection. */
        fun awaitReply(): Map<String, Any?> {
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                val reply = sink.firstOrNull { it["type"] != "projects_reloaded" }
                if (reply != null) return reply
                Thread.sleep(10)
            }
            throw AssertionError("no reply within 5s")
        }

        fun project(id: String): File = File(root, id).also { it.mkdirs() }
    }

    @Test
    fun `config_read returns the row files of a table directory, sorted`() {
        val h = Harness()
        val dir = File(h.project("boutique"), "data/categories").also { it.mkdirs() }
        File(dir, "weapons.yaml").writeText("name: Armes\n")
        File(dir, "_source.yaml").writeText("name: Catégories\n")
        File(dir, "notes.txt").writeText("ignored")
        File(dir, ".hidden.yaml").writeText("ignored")

        h.provider.handleMessageForTesting(
            """{"type":"config_read","request_id":"r1","project_id":"boutique","table":"data/categories"}"""
        )
        h.await()

        val msg = h.awaitReply()
        assertEquals("config_read_result", msg["type"])
        assertEquals("r1", msg["request_id"])
        assertEquals(true, msg["ok"])
        @Suppress("UNCHECKED_CAST")
        val files = msg["files"] as List<Map<String, String>>
        assertEquals(listOf("data/categories/_source.yaml", "data/categories/weapons.yaml"), files.map { it["path"] })
        assertEquals("name: Armes\n", files[1]["content"])
    }

    @Test
    fun `config_read resolves a single-file config by appending yaml`() {
        val h = Harness()
        val dataDir = File(h.project("boutique"), "data").also { it.mkdirs() }
        File(dataDir, "shop_settings.yaml").writeText("whole_shop_discount: 10\n")

        h.provider.handleMessageForTesting(
            """{"type":"config_read","request_id":"r2","project_id":"boutique","table":"data/shop_settings"}"""
        )
        h.await()

        @Suppress("UNCHECKED_CAST")
        val files = h.awaitReply()["files"] as List<Map<String, String>>
        assertEquals(listOf("data/shop_settings.yaml"), files.map { it["path"] })
    }

    @Test
    fun `config_read of a missing table answers ok with no files`() {
        val h = Harness()
        h.project("boutique")
        h.provider.handleMessageForTesting(
            """{"type":"config_read","request_id":"r3","project_id":"boutique","table":"data/nothing"}"""
        )
        h.await()
        assertEquals(true, h.awaitReply()["ok"])
        assertEquals(emptyList<Any>(), h.awaitReply()["files"])
    }

    @Test
    fun `config_read guards traversal, artisan namespace and unknown project`() {
        val h = Harness()
        h.project("boutique")
        // Three requests, three replies: waiting for the first is not enough.
        h.provider.handleMessageForTesting(
            """{"type":"config_read","request_id":"g1","project_id":"boutique","table":"../outside"}"""
        )
        h.provider.handleMessageForTesting(
            """{"type":"config_read","request_id":"g2","project_id":"boutique","table":".artisan/editor"}"""
        )
        h.provider.handleMessageForTesting(
            """{"type":"config_read","request_id":"g3","project_id":"ghost","table":"data/x"}"""
        )
        h.await(replies = 3)
        val byId = h.sink.filter { it["type"] != "projects_reloaded" }.associateBy { it["request_id"] }
        assertEquals("invalid_path", byId["g1"]!!["error"])
        assertEquals("invalid_path", byId["g2"]!!["error"])
        assertEquals("unknown_project", byId["g3"]!!["error"])
    }

    @Test
    fun `config_write ecrit atomiquement et supprime, sans rien pousser`() {
        val h = Harness()
        val dir = File(h.project("boutique"), "data/categories").also { it.mkdirs() }
        File(dir, "old.yaml").writeText("name: Old\n")
        h.latch = CountDownLatch(1) // config_write_result only

        val payload = mapOf(
            "type" to "config_write", "request_id" to "w1", "project_id" to "boutique",
            "files" to listOf(
                mapOf("path" to "data/categories/_source.yaml", "content" to "name: Catégories\n"),
                mapOf("path" to "data/categories/weapons.yaml", "content" to "name: Armes\n"),
            ),
            "deletes" to listOf("data/categories/old.yaml"),
        )
        h.provider.handleMessageForTesting(mapper.writeValueAsString(payload))
        h.await()

        assertEquals("name: Armes\n", File(dir, "weapons.yaml").readText())
        assertEquals("name: Catégories\n", File(dir, "_source.yaml").readText())
        assertFalse(File(dir, "old.yaml").exists())
        assertFalse(File(dir, "weapons.yaml.artisan-tmp").exists())

        // No push: the disk is the only truth (ADR `server-disk-only-storage`).
        val types = h.sink.map { it["type"] }
        assertFalse("local_push" in types, "nothing must be pushed, got $types")
        val result = h.sink.first { it["type"] == "config_write_result" }
        assertEquals(true, result["ok"])
        assertEquals("w1", result["request_id"])
    }

    @Test
    fun `config_write without a hub still writes`() {
        val h = Harness()
        h.project("boutique")
        val payload = mapOf(
            "type" to "config_write", "request_id" to "w2", "project_id" to "boutique",
            "files" to listOf(mapOf("path" to "data/shop_settings.yaml", "content" to "whole_shop_discount: 5\n")),
        )
        h.provider.handleMessageForTesting(mapper.writeValueAsString(payload))
        h.await()

        // The reload announcement is expected: it tells the editor to revalidate.
        assertFalse("local_push" in h.sink.map { it["type"] })
        assertEquals(true, h.awaitReply()["ok"])
        assertEquals("whole_shop_discount: 5\n", File(h.root, "boutique/data/shop_settings.yaml").readText())
    }

    @Test
    fun `config_write rejects unsafe paths without touching disk`() {
        val h = Harness()
        val projectDir = h.project("boutique")
        val payload = mapOf(
            "type" to "config_write", "request_id" to "w3", "project_id" to "boutique",
            "files" to listOf(
                mapOf("path" to "data/ok.yaml", "content" to "x: 1\n"),
                mapOf("path" to "../escape.yaml", "content" to "evil: true\n"),
            ),
        )
        h.provider.handleMessageForTesting(mapper.writeValueAsString(payload))
        h.await()

        assertEquals("invalid_path", h.awaitReply()["error"])
        assertFalse(File(projectDir, "data/ok.yaml").exists(), "partial write must not happen")
        assertFalse(File(h.root, "escape.yaml").exists())
    }

    @Test
    fun `config_write rejects artisan-namespace paths`() {
        val h = Harness()
        h.project("boutique")
        val payload = mapOf(
            "type" to "config_write", "request_id" to "w4", "project_id" to "boutique",
            "files" to listOf(mapOf("path" to ".artisan-sync.yaml", "content" to "hacked: true\n")),
        )
        h.provider.handleMessageForTesting(mapper.writeValueAsString(payload))
        h.await()
        assertEquals("invalid_path", h.awaitReply()["error"])
    }
}
