package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * `project_read` can say "nothing moved".
 *
 * The editor keeps a Project's last known version; without that answer it would have
 * to fetch the whole tree on every open to find out it is identical: several seconds,
 * for nothing. So it sends back the fingerprint it was given (`if_hash`), and the
 * plugin answers `unchanged` without carrying anything.
 *
 * The fingerprint is computed by the PLUGIN alone and simply handed back to it: nobody
 * else recomputes it, so there is no cross-language convention to keep.
 */
class ProjectReadIfHashTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_ifhash_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        var latch = CountDownLatch(1)
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
        fun write(projectId: String, rel: String, content: String) {
            val f = File(File(root, projectId), rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(projectId: String, ifHash: String? = null): Map<String, Any?> {
            latch = CountDownLatch(1)
            sink.clear()
            val hashField = if (ifHash == null) "" else ""","if_hash":"$ifHash""""
            provider.handleMessageForTesting(
                """{"type":"project_read","request_id":"r","project_id":"$projectId"$hashField}"""
            )
            assertTrue(latch.await(5, TimeUnit.SECONDS), "no reply within 5s")
            return sink.single { it["type"] != "projects_reloaded" }
        }
    }

    @Test
    fun `the reply carries the hash of what it contains`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        val hash = h.read("boutique")["hash"] as String?
        assertNotNull(hash, "project_read_result must carry a fingerprint")
        assertTrue(hash!!.isNotEmpty())
    }

    @Test
    fun `sending back the same hash means unchanged, without the tree`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        val hash = h.read("boutique")["hash"] as String

        val again = h.read("boutique", ifHash = hash)
        assertEquals(true, again["ok"])
        assertEquals(true, again["unchanged"])
        assertNull(again["files"], "an unchanged tree is not carried")
        assertEquals(hash, again["hash"])
    }

    @Test
    fun `a reload that changes the content changes the hash, and the tree comes back`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        val hash = h.read("boutique")["hash"] as String

        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 54\n")
        h.provider.load()

        val after = h.read("boutique", ifHash = hash)
        assertNull(after["unchanged"])
        assertNotEquals(hash, after["hash"])
        @Suppress("UNCHECKED_CAST")
        val files = after["files"] as List<Map<String, String>>
        assertEquals("schema: menu/v1\nsize: 54\n", files.single { it["path"] == "menus/m.yaml" }["content"])
    }

    @Test
    fun `une empreinte perimee ne fait pas passer un arbre pour inchange`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        val reply = h.read("boutique", ifHash = "empreinte-d-un-autre-monde")
        assertNull(reply["unchanged"])
        assertNotNull(reply["files"])
    }
}
