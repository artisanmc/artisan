package net.artisanmc.plugin

import net.artisanmc.plugin.sync.BundleHasher
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class BundleHasherTest {

    private fun makeProject(dir: File) {
        File(dir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: p_test\n")
        File(dir, "menus").mkdirs()
        File(dir, "menus/shop.yaml").writeText("id: shop\nsize: 27\n")
        File(dir, "lang").mkdirs()
        File(dir, "lang/en.yaml").writeText("title: Shop\n")
    }

    @Test
    fun `same directory content produces same hash`() {
        val dir1 = Files.createTempDirectory("bh1_").toFile().also { makeProject(it) }
        val dir2 = Files.createTempDirectory("bh2_").toFile().also { makeProject(it) }
        assertEquals(BundleHasher.hash(dir1), BundleHasher.hash(dir2))
    }

    @Test
    fun `changed file content changes hash`() {
        val dir = Files.createTempDirectory("bh3_").toFile().also { makeProject(it) }
        val before = BundleHasher.hash(dir)
        File(dir, "menus/shop.yaml").writeText("id: shop\nsize: 54\n")
        assertNotEquals(before, BundleHasher.hash(dir))
    }

    @Test
    fun `added file changes hash`() {
        val dir = Files.createTempDirectory("bh4_").toFile().also { makeProject(it) }
        val before = BundleHasher.hash(dir)
        File(dir, "menus/extra.yaml").writeText("id: extra\n")
        assertNotEquals(before, BundleHasher.hash(dir))
    }

    @Test
    fun `dot-artisan files are excluded from hash`() {
        val dir = Files.createTempDirectory("bh5_").toFile().also { makeProject(it) }
        val before = BundleHasher.hash(dir)
        File(dir, ".artisan-sync.yaml").writeText("synced_hash: abc\n")
        assertEquals(before, BundleHasher.hash(dir))
    }



    @Test
    fun `hash of empty directory returns empty string`() {
        val dir = Files.createTempDirectory("bh_empty_").toFile()
        assertEquals("", BundleHasher.hash(dir))
    }
}
