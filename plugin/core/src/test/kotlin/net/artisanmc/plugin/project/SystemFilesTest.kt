package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SystemFilesTest {
    private val root = Files.createTempDirectory("artisan-system").toFile()
    private val folder = File(root, "boutique_addon")

    @AfterTest fun teardown() { root.deleteRecursively() }

    private fun system(version: Int = 1, menu: String = "title: Shop\n") =
        TemplateDeclaration.builder("menus", version).system()
            .file("menus/shop_main.yaml", menu.toByteArray())
            .build()

    private fun menu() = File(folder, "menus/shop_main.yaml")
    private fun origin() = ProjectOrigins.read(folder).getValue("menus/shop_main.yaml")
    private fun hash(text: String) = ContentHash.hashBytes(text.toByteArray())

    @Test
    fun `a missing system file is written, again after a delete`() {
        assertEquals(listOf("menus/shop_main.yaml"), SystemFiles.sync(folder, "boutique", system()))
        assertEquals("title: Shop\n", menu().readText())
        assertEquals(FileOrigin("boutique", "menus", 1, hash("title: Shop\n")), origin())
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system()), "nothing to do twice")

        menu().delete()
        assertEquals(listOf("menus/shop_main.yaml"), SystemFiles.sync(folder, "boutique", system()))
        assertTrue(menu().isFile)
    }

    @Test
    fun `an untouched copy follows the new version, an edited one stays the owner's`() {
        SystemFiles.sync(folder, "boutique", system())
        assertEquals(listOf("menus/shop_main.yaml"), SystemFiles.sync(folder, "boutique", system(2, "title: Shop v2\n")))
        assertEquals("title: Shop v2\n", menu().readText())
        assertEquals(2, origin().version)

        menu().writeText("title: Mine\n")
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system(3, "title: Shop v3\n")))
        assertEquals("title: Mine\n", menu().readText())
        assertEquals(FileOrigin("boutique", "menus", 2, hash("title: Shop v2\n")), origin(), "the editor offers v3")
    }

    private fun bases() = File(folder, SystemFiles.BASES).list().orEmpty().toSet()

    @Test
    fun `an edited file takes in what the new version changes elsewhere`() {
        val v1 = "title: Shop\nsize: 27\n"
        SystemFiles.sync(folder, "boutique", system(1, v1))
        assertEquals(setOf(hash(v1)), bases(), "the shipped content is kept as the base")
        menu().writeText("title: Mine\nsize: 27\n")

        val v2 = "title: Shop\nsize: 54\nescape_goes_back: true\n"
        val merged = mutableListOf<Pair<String, List<String>>>()
        assertEquals(listOf("menus/shop_main.yaml"), SystemFiles.sync(folder, "boutique", system(2, v2)) { p, c -> merged += p to c })
        assertEquals("title: Mine\nsize: 54\nescape_goes_back: true\n", menu().readText())
        assertEquals(listOf("menus/shop_main.yaml" to emptyList<String>()), merged)
        assertEquals(FileOrigin("boutique", "menus", 2, hash(v2)), origin(), "follows v2 from here on")
        assertEquals(setOf(hash(v2)), bases(), "v1's base goes with the last origin naming it")
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system(2, v2)), "nothing to do twice")
    }

    @Test
    fun `a conflict keeps the owner's value and the origin, so the editor offers the version`() {
        SystemFiles.sync(folder, "boutique", system(1, "title: Shop\nsize: 27\n"))
        menu().writeText("title: Mine\nsize: 27\n")
        val v2 = "title: Shop v2\nsize: 54\n"
        val merged = mutableListOf<List<String>>()
        SystemFiles.sync(folder, "boutique", system(2, v2)) { _, c -> merged += c }
        assertEquals("title: Mine\nsize: 54\n", menu().readText())
        assertEquals(listOf(listOf("title")), merged)
        assertEquals(1, origin().version)
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system(2, v2)), "merged once: the next start has nothing to do")

        // Reset: the shipped file again, followed from there.
        menu().writeText(v2)
        SystemFiles.sync(folder, "boutique", system(2, v2))
        assertEquals(FileOrigin("boutique", "menus", 2, hash(v2)), origin())
        assertEquals(setOf(hash(v2)), bases())
    }

    @Test
    fun `without a kept base an edited file stays as it is`() {
        SystemFiles.sync(folder, "boutique", system())
        menu().writeText("title: Mine\n")
        File(folder, SystemFiles.BASES).deleteRecursively()
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system(2, "title: Shop\nsize: 54\n")))
        assertEquals("title: Mine\n", menu().readText())
        assertEquals(1, origin().version)
    }

    @Test
    fun `bases are private metadata`() {
        assertTrue(ProjectPathPolicy.isPrivate("${SystemFiles.BASES}/abc"))
        SystemFiles.sync(folder, "boutique", system())
        assertTrue(ProjectFilesReader.readAll(folder).keys.none { it.startsWith(SystemFiles.BASES) })
    }

    @Test
    fun `a file there before the module made it a system element counts as edited`() {
        menu().apply { parentFile.mkdirs(); writeText("title: Copied once\n") }
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system()))
        assertEquals("title: Copied once\n", menu().readText())
        assertEquals(hash("title: Shop\n"), origin().hash)

        File(root, "other/menus/shop_main.yaml").apply { parentFile.mkdirs(); writeText("title: Shop\n") }
        val other = File(root, "other")
        assertEquals(emptyList(), SystemFiles.sync(other, "boutique", system()), "the shipped content: recorded only")
        assertEquals(hash("title: Shop\n"), ProjectOrigins.read(other).getValue("menus/shop_main.yaml").hash)
    }

    @Test
    fun `a system file moved to a folder of the module is not written again`() {
        SystemFiles.sync(folder, "boutique", system())
        val moved = File(folder, "vitrine/menus/shop_main.yaml")
        moved.parentFile.mkdirs()
        menu().renameTo(moved)
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system()))
        assertTrue(!menu().exists())
    }

    @Test
    fun `a system template seeds no project`() {
        assertFailsWith<IllegalArgumentException> {
            TemplateDeclaration.builder("menus", 1).system().seed("shop").file("menus/a.yaml", byteArrayOf(1)).build()
        }
        assertEquals(true, system().toWire()["system"])
    }
}
