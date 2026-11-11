package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class ProjectFilesReaderScanTest {
    private val dir = Files.createTempDirectory("artisan-scan").toFile()

    @AfterTest fun teardown() { dir.deleteRecursively() }

    @Test fun `one walk yields the texts and the binaries`() {
        File(dir, "menus/a.yaml").apply { parentFile.mkdirs() }.writeText("a: 1")
        File(dir, "assets/i.png").apply { parentFile.mkdirs() }.writeBytes(byteArrayOf(-119, 80, 78, 71))
        File(dir, ".artisan/editor.yaml").apply { parentFile.mkdirs() }.writeText("board: {}")
        File(dir, ".artisan/history/menus/a.yaml/1").apply { parentFile.mkdirs() }.writeText("old")
        File(dir, ".artisan/drafts/d/draft.json").apply { parentFile.mkdirs() }.writeText("{}")
        File(dir, ".artisan/x.png").writeBytes(byteArrayOf(1))
        val scanned = ProjectFilesReader.scan(dir)
        assertEquals(setOf("menus/a.yaml", ".artisan/editor.yaml"), scanned.texts.keys)
        assertEquals(setOf("assets/i.png"), scanned.binaries.keys)
        assertEquals(ProjectFilesReader.readAll(dir), scanned.texts)
        assertEquals(ProjectFilesReader.binaries(dir), scanned.binaries)
    }

    @Test fun `a binary unchanged in size and mtime keeps its hash, a changed one is hashed again`() {
        val png = File(dir, "assets/i.png").apply { parentFile.mkdirs() }
        png.writeBytes(byteArrayOf(1, 2, 3))
        png.setLastModified(1_000_000_000_000L)
        val cache = ProjectFilesReader.BinaryHashCache()
        val first = ProjectFilesReader.scan(dir, cache).binaries.getValue("assets/i.png").hash
        // The bytes change behind the cache's back, size and mtime kept: the cache answers.
        png.writeBytes(byteArrayOf(3, 2, 1))
        png.setLastModified(1_000_000_000_000L)
        assertEquals(first, ProjectFilesReader.scan(dir, cache).binaries.getValue("assets/i.png").hash)
        png.setLastModified(2_000_000_000_000L)
        val rehashed = ProjectFilesReader.scan(dir, cache).binaries.getValue("assets/i.png").hash
        assertNotEquals(first, rehashed)
        assertEquals(ContentHash.hashBytes(byteArrayOf(3, 2, 1)), rehashed)
        cache.prune(emptySet())
        assertEquals(0, cache.size)
    }
}
