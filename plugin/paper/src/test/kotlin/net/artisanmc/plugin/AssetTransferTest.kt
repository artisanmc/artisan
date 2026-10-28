package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Transfer of **binary assets** (ADR `assets-on-server-disk`).
 *
 * A PNG cannot travel in the `project_read` tree: that tree goes out whole on every
 * open, as UTF-8. Base64 would inflate it by a third for content the editor only needs
 * when displaying it, and reading a PNG as UTF-8 would destroy it.
 *
 * Hence the structural rule: the tree **announces** binaries (path + hash + size)
 * without carrying them; `asset_read` reads them one by one, by path, and
 * `project_write` writes them through its `binaries` list.
 */
class AssetTransferTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_asset_").toFile()
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
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        private var operations = 0
        /** `project_write` without text files: each write has its own operation. */
        fun writeBinaries(vararg paths: String, content: String) = send(
            """{"type":"project_write","request_id":"r","operation_id":"op-${++operations}","project_id":"boutique","binaries":[""" +
                paths.joinToString(",") { """{"path":"$it","content_base64":"$content","base_hash":null}""" } + "]}",
        )
        fun write(project: File, rel: String, bytes: ByteArray) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeBytes(bytes)
        }
        fun send(json: String): Map<String, Any?> {
            latch = CountDownLatch(1)
            sink.clear()
            provider.handleMessageForTesting(json)
            // The reply, not the first thing that comes by: reload announcements
            // travel on the same connection and may precede it.
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                val reply = sink.firstOrNull { it["type"] != "projects_reloaded" }
                if (reply != null) return reply
                Thread.sleep(10)
            }
            throw AssertionError("no reply within 5s")
        }
        fun read(projectId: String): Map<String, Any?> =
            send("""{"type":"project_read","request_id":"r","project_id":"$projectId"}""")
        fun assetRead(projectId: String, path: String): Map<String, Any?> =
            send("""{"type":"asset_read","request_id":"r","project_id":"$projectId","path":"$path"}""")
    }

    /** A minimal but real PNG: header + non-UTF-8 bytes (0x89, 0xFF…). */
    private val png = byteArrayOf(
        0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0xFF.toByte(), 0x00, 0xC3.toByte(), 0x28,
    )

    @Test
    fun `the tree lists binaries without carrying them`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 27\n".toByteArray())
        h.write(p, "assets/glyphs/diamant.png", png)
        h.provider.load()

        val res = h.read("boutique")
        @Suppress("UNCHECKED_CAST")
        val files = res["files"] as List<Map<String, String>>
        @Suppress("UNCHECKED_CAST")
        val binaries = res["binaries"] as List<Map<String, Any?>>

        // The PNG is not in the tree: reading it as UTF-8 would have mangled it, and
        // carrying it as base64 would inflate every Project open.
        assertTrue(files.none { it["path"] == "assets/glyphs/diamant.png" })
        assertEquals(listOf("menus/m.yaml"), files.map { it["path"] })

        // But its existence is announced: the editor knows what to offer without
        // downloading everything.
        val entry = binaries.single()
        assertEquals("assets/glyphs/diamant.png", entry["path"])
        assertEquals(png.size, (entry["size"] as Number).toInt())
        assertTrue((entry["hash"] as String).length == 64, "expected a SHA-256 hex hash")
    }

    @Test
    fun `asset_read returns the exact bytes`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "assets/glyphs/diamant.png", png)
        h.provider.load()

        val res = h.assetRead("boutique", "assets/glyphs/diamant.png")
        assertEquals(true, res["ok"])
        // EXACT bytes: a base64 round trip that normalised anything would make the
        // image invalid and the compare-and-swap wrong.
        assertArrayEquals(png, Base64.getDecoder().decode(res["content_base64"] as String))
    }

    @Test
    fun `project_write writes a binary and rejects it if the base moved`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\n".toByteArray())
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        // base_hash null = "I expect the file not to exist".
        val created = h.writeBinaries("assets/glyphs/diamant.png", content = b64)
        assertEquals(true, created["ok"])
        assertArrayEquals(png, File(p, "assets/glyphs/diamant.png").readBytes())

        // Rewriting while claiming the file is still absent must be refused: otherwise
        // two admins uploading the same name silently overwrite each other.
        val conflict = h.writeBinaries("assets/glyphs/diamant.png", content = b64)
        assertEquals(false, conflict["ok"])
        assertEquals("conflict", conflict["error"])
    }

    @Test
    fun `a written binary is visible without a manual reload`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\n".toByteArray())
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        h.writeBinaries("assets/textures/fond.png", content = b64)

        // Writing means knowing you wrote: the snapshot picks it up, otherwise the
        // editor would upload an image it could not see afterwards.
        @Suppress("UNCHECKED_CAST")
        val binaries = h.read("boutique")["binaries"] as List<Map<String, Any?>>
        assertEquals(listOf("assets/textures/fond.png"), binaries.map { it["path"] })
    }

    /**
     * BATCHED write (ADR `assets-on-server-disk`, unpacked fonts).
     *
     * An imported font is ~96 files (measured on vanilla ASCII: 95 PNGs + its
     * descriptor, 26 KB in total). Writing them one by one would take 96 round trips
     * and, above all, would leave a half-written font if one failed: all or nothing.
     */
    @Test
    fun `project_write writes several binaries all or nothing`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\n".toByteArray())
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        val res = h.writeBinaries("assets/fonts/pixelmix/a.png", "assets/fonts/pixelmix/b.png", content = b64)
        assertEquals(true, res["ok"])
        assertArrayEquals(png, File(p, "assets/fonts/pixelmix/a.png").readBytes())
        assertArrayEquals(png, File(p, "assets/fonts/pixelmix/b.png").readBytes())
    }

    @Test
    fun `a single stale file cancels the whole batch`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "assets/fonts/pixelmix/b.png", png)
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        // The second claims the file does not exist; it does.
        val res = h.writeBinaries("assets/fonts/pixelmix/a.png", "assets/fonts/pixelmix/b.png", content = b64)
        assertEquals(false, res["ok"])
        assertEquals("conflict", res["error"])
        // NOTHING was written: a half-written font would be worse than none.
        assertFalse(File(p, "assets/fonts/pixelmix/a.png").exists())
    }
}
