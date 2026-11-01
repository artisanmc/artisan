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

    /** The owner's file. */
    private fun menu() = File(folder, "menus/shop_main.yml")
    private fun original() = File(folder, "originals/menus/shop_main.yml")
    private fun origin() = ProjectOrigins.read(folder).getValue("menus/shop_main.yml")
    private fun origins() = ProjectOrigins.read(folder)
    private fun hash(text: String) = ContentHash.hashBytes(text.toByteArray())
    private fun index() = net.artisanmc.plugin.model.Originals.parseIndex(File(folder, "originals/originals.yml").readText())

    @Test
    fun `the shipped file lives in originals, required, and the owner's folder stays empty`() {
        assertEquals(listOf("originals/menus/shop_main.yml", "originals/originals.yml"), SystemFiles.sync(folder, "boutique", system()))
        assertEquals("title: Shop\n", original().readText())
        assertTrue(!menu().exists())
        assertEquals(FileOrigin("boutique", "menus", 1, hash("title: Shop\n")), origins().getValue("originals/menus/shop_main.yml"))
        assertEquals(listOf("menus/shop_main.yml"), index().required)
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system()), "nothing to do twice")

        original().delete()
        assertEquals(listOf("originals/menus/shop_main.yml"), SystemFiles.sync(folder, "boutique", system()))
    }

    @Test
    fun `an old full copy goes, an edited one stays the owner's`() {
        menu().apply { parentFile.mkdirs(); writeText("title: Shop\n") }
        File(folder, ProjectOrigins.PATH).apply { parentFile.mkdirs() }
            .writeBytes(ProjectOrigins.serialize(mapOf("menus/shop_main.yml" to FileOrigin("boutique", "menus", 1, hash("title: Shop\n")))))
        SystemFiles.sync(folder, "boutique", system(2, "title: Shop v2\n"))
        assertTrue(!menu().exists(), "an untouched copy of v1: the original serves")
        assertEquals("title: Shop v2\n", original().readText())
        assertTrue("menus/shop_main.yml" !in origins())

        menu().apply { parentFile.mkdirs(); writeText("title: Mine\n") }
        SystemFiles.sync(folder, "boutique", system(3, "title: Shop v3\n"))
        assertEquals("title: Mine\n", menu().readText(), "no origin: edited, kept")
        assertEquals("title: Shop v3\n", original().readText())
        assertEquals(hash("title: Shop v3\n"), origin().hash, "counts as edited from v3")
    }

    private fun bases() = File(folder, SystemFiles.BASES).list().orEmpty().toSet()

    /** The owner edits the menu as it was shipped in [v]. */
    private fun edit(v: String, mine: String) {
        SystemFiles.sync(folder, "boutique", system(1, v))
        menu().apply { parentFile.mkdirs(); writeText(mine) }
        SystemFiles.sync(folder, "boutique", system(1, v))
    }

    @Test
    fun `an edited file takes in what the new version changes elsewhere`() {
        val v1 = "title: Shop\nsize: 27\n"
        edit(v1, "title: Mine\nsize: 27\n")
        assertEquals(FileOrigin("boutique", "menus", 1, hash(v1)), origin())
        assertEquals(setOf(hash(v1)), bases(), "the shipped content is kept as the base")

        val v2 = "title: Shop\nsize: 54\nescape_goes_back: true\n"
        val merged = mutableListOf<Pair<String, List<String>>>()
        SystemFiles.sync(folder, "boutique", system(2, v2)) { p, c -> merged += p to c }
        assertEquals("title: Mine\nsize: 54\nescape_goes_back: true\n", menu().readText())
        assertEquals(listOf("menus/shop_main.yml" to emptyList<String>()), merged)
        assertEquals(FileOrigin("boutique", "menus", 2, hash(v2)), origin(), "follows v2 from here on")
        assertEquals(setOf(hash(v2)), bases(), "v1's base goes with the last origin naming it")
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system(2, v2)), "nothing to do twice")
    }

    @Test
    fun `an edit the new version also makes leaves nothing of the owner's`() {
        edit("title: Shop\n", "title: Shop v2\n")
        SystemFiles.sync(folder, "boutique", system(2, "title: Shop v2\n"))
        assertTrue(!menu().exists())
        assertTrue("menus/shop_main.yml" !in origins())
        assertEquals(emptySet(), bases())
    }

    @Test
    fun `a conflict keeps the owner's value and the origin, so the editor offers the version`() {
        edit("title: Shop\nsize: 27\n", "title: Mine\nsize: 27\n")
        val v2 = "title: Shop v2\nsize: 54\n"
        val merged = mutableListOf<List<String>>()
        SystemFiles.sync(folder, "boutique", system(2, v2)) { _, c -> merged += c }
        assertEquals("title: Mine\nsize: 54\n", menu().readText())
        assertEquals(listOf(listOf("title")), merged)
        assertEquals(1, origin().version)
        assertEquals(emptyList(), SystemFiles.sync(folder, "boutique", system(2, v2)), "merged once: the next start has nothing to do")

        // Back to the original: the owner's file goes.
        menu().delete()
        SystemFiles.sync(folder, "boutique", system(2, v2))
        assertTrue("menus/shop_main.yml" !in origins())
        assertEquals(emptySet(), bases())
    }

    @Test
    fun `without a kept base an edited file stays as it is`() {
        edit("title: Shop\n", "title: Mine\n")
        File(folder, SystemFiles.BASES).deleteRecursively()
        SystemFiles.sync(folder, "boutique", system(2, "title: Shop\nsize: 54\n"))
        assertEquals("title: Mine\n", menu().readText())
        assertEquals(1, origin().version)
    }

    @Test
    fun `a file no longer shipped leaves originals`() {
        SystemFiles.sync(folder, "boutique", system())
        val other = TemplateDeclaration.builder("menus", 2).system().file("menus/other.yml", "title: O\n".toByteArray()).build()
        SystemFiles.sync(folder, "boutique", other)
        assertTrue(!original().exists())
        assertTrue(File(folder, "originals/menus/other.yml").isFile)
        assertEquals(listOf("menus/other.yml"), index().required)
    }

    @Test
    fun `an example the owner deleted before originals is excluded, not brought back`() {
        File(folder, "artisan-module.yml").apply { parentFile.mkdirs(); writeText("schema: module/v1\n") }
        val examples = TemplateDeclaration.builder("examples", 1).file("menus/shop_main.yml", "title: Shop\n".toByteArray()).build()
        File(folder, ProjectOrigins.PATH).apply { parentFile.mkdirs() }
            .writeBytes(ProjectOrigins.serialize(mapOf("menus/shop_main.yml" to FileOrigin("boutique", "examples", 1, hash("title: Shop\n")))))
        SystemFiles.sync(folder, "boutique", examples, required = false, seeded = true)
        assertTrue(original().isFile)
        assertEquals(emptyList(), index().required)
        val manifest = net.artisanmc.plugin.model.ManifestYaml.parse(File(folder, "artisan-module.yml").readText())!!
        assertEquals(listOf("menus/shop_main.yml"), manifest.originals.exclude)
    }

    @Test
    fun `bases are private metadata`() {
        assertTrue(ProjectPathPolicy.isPrivate("${SystemFiles.BASES}/abc"))
        SystemFiles.sync(folder, "boutique", system())
        assertTrue(ProjectFilesReader.readAll(folder).keys.none { it.startsWith(SystemFiles.BASES) })
    }

    @Test
    fun `a system template seeds no project`() {
        assertFailsWith<IllegalArgumentException> {
            TemplateDeclaration.builder("menus", 1).system().seed("shop").file("menus/a.yaml", byteArrayOf(1)).build()
        }
        assertEquals(true, system().toWire()["system"])
    }
}
