package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** What a module ships, kept in a folder that holds its whole tree (ADR `editable-module-tree`, decisions 3 and 4). */
class TreeSyncTest {
    private val root = Files.createTempDirectory("artisan-tree").toFile()
    private val folder = File(root, "shop")

    @AfterTest fun teardown() { root.deleteRecursively() }

    private fun system(version: Int, vararg files: Pair<String, String>, required: Boolean = true) =
        TemplateDeclaration.builder("menus", version).let { if (required) it.system() else it }
            .apply { files.forEach { (p, c) -> file(p, c.toByteArray()) } }.build()

    private fun file(rel: String) = File(folder, rel)
    private fun index() = ShippedIndex.read(folder)
    private fun hash(s: String) = ContentHash.hashBytes(s.toByteArray())
    private fun sync(t: TemplateDeclaration, required: Boolean = t.isSystem, restored: MutableList<String> = mutableListOf()) =
        SystemFiles.sync(folder, "shop", t, required = required, onRestored = { restored += it })

    @Test
    fun `a shipped file lands at its own path, indexed, and nothing happens twice`() {
        assertEquals(listOf("menus/main.yml"), sync(system(1, "menus/main.yml" to "title: Shop\n")))
        assertEquals("title: Shop\n", file("menus/main.yml").readText())
        assertEquals(ShippedIndex.Entry("shop", "menus", 1, hash("title: Shop\n"), required = true), index().getValue("menus/main.yml"))
        assertFalse(file("originals").exists())
        assertEquals(emptyList(), sync(system(1, "menus/main.yml" to "title: Shop\n")))
        assertEquals(index().mapValues { it.value.origin }, ProjectOrigins.read(folder), "origins mirror the index")
    }

    @Test
    fun `an untouched file follows the module, even reformatted`() {
        sync(system(1, "menus/main.yml" to "title: Shop\nsize: 27\n"))
        sync(system(2, "menus/main.yml" to "title: Shop v2\nsize: 27\n"))
        assertEquals("title: Shop v2\nsize: 27\n", file("menus/main.yml").readText())

        file("menus/main.yml").writeText("size: 27\ntitle: 'Shop v2'\n")
        sync(system(3, "menus/main.yml" to "title: Shop v3\nsize: 27\n"))
        assertEquals("title: Shop v3\nsize: 27\n", file("menus/main.yml").readText(), "same value, other text: untouched")
        assertEquals(3, index().getValue("menus/main.yml").version)
    }

    @Test
    fun `an edited file merges, and a conflict keeps the owner's value and the old version`() {
        sync(system(1, "menus/main.yml" to "title: Shop\nsize: 27\n"))
        file("menus/main.yml").writeText("title: Mine\nsize: 27\n")
        sync(system(2, "menus/main.yml" to "title: Shop\nsize: 54\n"))
        assertEquals("title: Mine\nsize: 54\n", file("menus/main.yml").readText())
        assertEquals(2, index().getValue("menus/main.yml").version)

        sync(system(3, "menus/main.yml" to "title: Shop v3\nsize: 54\n"))
        assertEquals("title: Mine\nsize: 54\n", file("menus/main.yml").readText())
        assertEquals(2, index().getValue("menus/main.yml").version, "update available: still against v2")
    }

    @Test
    fun `an added comment makes the file the owner's`() {
        sync(system(1, "menus/main.yml" to "title: Shop\n"))
        file("menus/main.yml").writeText("# my shop\ntitle: Shop\n")
        assertFalse(TreeSync.untouched(folder, "menus/main.yml", file("menus/main.yml").readBytes(), hash("title: Shop\n")))
        file("menus/main.yml").writeText("title: Shop  # mine\n")
        assertFalse(TreeSync.untouched(folder, "menus/main.yml", file("menus/main.yml").readBytes(), hash("title: Shop\n")))
        file("menus/main.yml").writeText("title: \"Shop\"\n")
        assertTrue(TreeSync.untouched(folder, "menus/main.yml", file("menus/main.yml").readBytes(), hash("title: Shop\n")))
    }

    @Test
    fun `a deleted optional file stays deleted, a required one comes back`() {
        val t = system(1, "menus/main.yml" to "title: Main\n", "menus/top.yml" to "title: Top\n", required = false)
        sync(t)
        file("menus/top.yml").delete()
        File(folder, "artisan-module.yml").writeText("schema: module/v1\n")
        sync(system(2, "menus/main.yml" to "title: Main\n", "menus/top.yml" to "title: Top v2\n", required = false))
        assertFalse(file("menus/top.yml").exists())
        assertTrue("menus/top.yml" in File(folder, "artisan-module.yml").readText(), "listed in originals.exclude")
        assertTrue("menus/top.yml" in index(), "still indexed: deleted")

        val restored = mutableListOf<String>()
        sync(system(1, "menus/main.yml" to "title: Main\n"), restored = restored)
        file("menus/main.yml").delete()
        sync(system(1, "menus/main.yml" to "title: Main\n"), restored = restored)
        assertTrue(file("menus/main.yml").isFile)
        assertEquals(listOf("menus/main.yml"), restored)
    }

    @Test
    fun `a Document moved into a folder is not written again`() {
        sync(system(1, "menus/main.yml" to "title: Main\n", required = false))
        File(folder, "shop/menus").mkdirs()
        file("menus/main.yml").renameTo(file("shop/menus/main.yml"))
        sync(system(2, "menus/main.yml" to "title: Main v2\n", required = false))
        assertFalse(file("menus/main.yml").exists())
    }

    @Test
    fun `a file already there is the owner's, compared from the shipped version`() {
        File(folder, "menus").mkdirs()
        file("menus/main.yml").writeText("title: Hand made\n")
        sync(system(1, "menus/main.yml" to "title: Shop\n"))
        assertEquals("title: Hand made\n", file("menus/main.yml").readText())
        assertEquals(hash("title: Shop\n"), index().getValue("menus/main.yml").hash)
    }

    @Test
    fun `what the module no longer ships goes when untouched, stays the owner's when edited`() {
        sync(system(1, "menus/main.yml" to "title: Main\n", "menus/a.yml" to "title: A\n", "menus/b.yml" to "title: B\n"))
        file("menus/b.yml").writeText("title: Mine\n")
        sync(system(2, "menus/main.yml" to "title: Main\n"))
        assertFalse(file("menus/a.yml").exists())
        assertEquals("title: Mine\n", file("menus/b.yml").readText())
        assertEquals(setOf("menus/main.yml"), index().keys)
    }

    @Test
    fun `a conflict says an update is available until the owner keeps their version`() {
        sync(system(1, "menus/main.yml" to "title: Shop\n"))
        file("menus/main.yml").writeText("title: Mine\n")
        val v2 = system(2, "menus/main.yml" to "title: Shop v2\n")
        sync(v2)
        assertEquals("title: Mine\n", file("menus/main.yml").readText())
        val templates = TreeSync.Templates { m, t -> v2.takeIf { m == "shop" && t == "menus" } }
        val pending = TreeSync.pending(folder, templates)
        assertEquals(hash("title: Shop v2\n"), pending.getValue("originals/menus/main.yml").hash)
        assertEquals(1, ProjectOrigins.read(folder).getValue("menus/main.yml").version)

        assertTrue(SystemFiles.keep(folder, "menus/main.yml", templates))
        assertEquals(2, index().getValue("menus/main.yml").version)
        assertEquals(emptyMap(), TreeSync.pending(folder, templates))
        assertTrue(SystemFiles.base(folder, hash("title: Shop v2\n")).isFile, "the next update merges from it")
        assertTrue(SystemFiles.keep(folder, "menus/main.yml", templates), "already kept")
        assertFalse(SystemFiles.keep(folder, "menus/other.yml", templates))
    }
}
