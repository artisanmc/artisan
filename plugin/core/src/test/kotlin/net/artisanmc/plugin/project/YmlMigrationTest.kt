package net.artisanmc.plugin.project

import net.artisanmc.plugin.model.ModuleFile
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class YmlMigrationTest {
    private val coreRoot = Files.createTempDirectory("artisan-yml").toFile()
    private val shop = File(coreRoot, "shop")

    @AfterTest fun teardown() { coreRoot.deleteRecursively() }

    private fun write(dir: File, path: String, text: String) =
        File(dir, path).apply { parentFile.mkdirs(); writeText(text) }

    @Test
    fun `yaml files and the module file move to yml, as they are, origins with them`() {
        write(shop, "manifest.yaml", "schema: manifest/v1\ndefault_lang: fr\n")
        write(shop, "menus/main.yaml", "title: Main\n")
        write(shop, "data/categories/_source.yaml", "model: x\n")
        write(shop, "lang/fr.yml", "a: b\n")
        write(shop, "assets/logo.png", "png")
        write(shop, ProjectOrigins.PATH, String(ProjectOrigins.serialize(mapOf("menus/main.yaml" to FileOrigin("boutique", "menus", 1, "h")))))

        val renames = YmlMigration.run(shop)

        assertEquals(
            mapOf(
                "data/categories/_source.yaml" to "data/categories/_source.yml",
                "manifest.yaml" to ModuleFile.NAME,
                "menus/main.yaml" to "menus/main.yml",
            ),
            renames,
        )
        assertEquals("schema: manifest/v1\ndefault_lang: fr\n", File(shop, ModuleFile.NAME).readText(), "the bytes stay: a draft still matches")
        assertEquals("title: Main\n", File(shop, "menus/main.yml").readText())
        assertFalse(File(shop, "menus/main.yaml").exists())
        assertTrue(File(shop, "assets/logo.png").isFile)
        assertEquals(setOf("menus/main.yml"), ProjectOrigins.read(shop).keys)
        assertTrue(File(shop, ProjectOrigins.PATH).isFile, "the metadata keeps its own name")
        assertEquals(emptyMap(), YmlMigration.run(shop), "nothing to do twice")
    }

    @Test
    fun `a file whose yml twin is there stays, both are left to the owner`() {
        write(shop, "artisan-module.yml", "schema: module/v1\n")
        write(shop, "manifest.yaml", "schema: manifest/v1\n")
        write(shop, "menus/main.yaml", "title: Old\n")
        write(shop, "menus/main.yml", "title: New\n")

        assertEquals(emptyMap(), YmlMigration.run(shop))
        assertEquals("title: Old\n", File(shop, "menus/main.yaml").readText())
        assertEquals("schema: manifest/v1\n", File(shop, "manifest.yaml").readText())
    }

    @Test
    fun `the start moves the modules root's folders, not an add-on root or a configuration`() {
        write(shop, "manifest.yaml", "schema: manifest/v1\n")
        val addon = Files.createTempDirectory("artisan-addon").toFile()
        val config = Files.createTempDirectory("artisan-config").toFile()
        try {
            write(addon, "manifest.yaml", "schema: manifest/v1\n")
            write(config, "settings.yaml", "a: 1\n")
            val roots = ProjectRoots(coreRoot, moveToYml = true)
            roots.register("boutique", addon, "boutique")
            roots.registerConfig("boutique_config", config, "boutique")
            roots.all()
            assertTrue(File(shop, ModuleFile.NAME).isFile)
            assertTrue(File(addon, "manifest.yaml").isFile)
            assertTrue(File(config, "settings.yaml").isFile)

            write(coreRoot, "other/manifest.yaml", "schema: manifest/v1\n")
            assertTrue(File(coreRoot, "other/manifest.yaml").isFile.also { ProjectRoots(coreRoot).all() }, "other readers leave the disk")
        } finally {
            addon.deleteRecursively()
            config.deleteRecursively()
        }
    }
}
