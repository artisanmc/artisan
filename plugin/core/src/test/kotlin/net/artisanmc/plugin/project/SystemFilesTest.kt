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
