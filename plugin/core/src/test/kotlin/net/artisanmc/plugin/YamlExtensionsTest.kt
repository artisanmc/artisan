package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectContentReader
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** `.yml` and `.yaml` are both read, `artisan-module.yml` as a module file (`model/YamlFiles`, `model/ModuleFile`). */
class YamlExtensionsTest {
    private val root = Files.createTempDirectory("artisan-yml").toFile()
    private val dir = File(root, "shop")

    @AfterTest fun teardown() { root.deleteRecursively() }

    private fun write(path: String, text: String) = File(dir, path).apply { parentFile.mkdirs(); writeText(text) }

    private fun read(): Pair<net.artisanmc.plugin.engine.RuntimeProject?, List<String>> {
        val skipped = mutableListOf<String>()
        val project = ProjectReader(ProjectRoots(root), null, { emptyMap() }, onSkip = { _, path, _ -> skipped += path }).readAll().singleOrNull()
        return project to skipped
    }

    @Test
    fun `a module of yml files reads like one of yaml files`() {
        write("artisan-module.yml", "schema: module/v1\ndefault_lang: fr\nlanguages: [fr]\n")
        write("menus/main.yml", "title: Boutique\nsize: 27\n")
        write("lang/fr.yml", "shop:\n  title: Boutique\n")
        write("data/settings.yml", "discount: 10\n")
        write("data/rows/a.yml", "name: A\n")
        write("data/rows/_source.yml", "order: [a]\n")
        write("models/settings.yml", "fields:\n  - name: discount\n    kind: integer\n")

        val (project, skipped) = read()
        project!!
        assertEquals("fr", project.defaultLang)
        assertEquals(listOf("main"), project.menus.map { it.id })
        assertEquals("Boutique", project.langMaps.getValue("fr")["shop.title"])
        assertEquals(listOf("rows", "settings"), project.dataSources.map { it.id }.sorted())
        assertEquals(emptyList(), skipped)
    }

    @Test
    fun `one Document under both extensions is refused, another file is read from its yml copy`() {
        write("manifest.yaml", "schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")
        write("menus/main.yml", "title: A\n")
        write("menus/main.yaml", "title: B\n")
        write("lang/en.yaml", "k: old\n")
        write("lang/en.yml", "k: new\n")

        val (project, skipped) = read()
        assertTrue(project!!.menus.isEmpty())
        assertEquals(listOf("menus/main.yaml", "menus/main.yml"), skipped.sorted())
        assertEquals("new", project.langMaps.getValue("en")["k"])
    }

    @Test
    fun `artisan-module yml wins over manifest yaml`() {
        write("artisan-module.yml", "schema: module/v1\ndefault_lang: de\nlanguages: [de]\n")
        write("manifest.yaml", "schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")
        assertEquals("de", read().first!!.defaultLang)
    }

    @Test
    fun `an add-on reading a yaml name gets the yml file`() {
        write("artisan-module.yml", "schema: module/v1\n")
        write("lang/fr.yml", "a: b\n")
        write("data/config.yaml", "x: 1\n")
        val reader = ProjectContentReader(ProjectRoots(root))
        assertEquals("a: b\n", reader.read("shop", "lang/fr.yaml"))
        assertEquals("x: 1\n", reader.read("shop", "data/config.yml"))
        assertEquals("schema: module/v1\n", reader.read("shop", "manifest.yaml"))
        assertEquals(null, reader.read("shop", "lang/en.yaml"))
    }
}
