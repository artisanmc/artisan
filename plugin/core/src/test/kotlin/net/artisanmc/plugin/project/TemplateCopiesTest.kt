package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TemplateCopiesTest {
    private val coreRoot = Files.createTempDirectory("artisan-templates").toFile()
    private val project = File(coreRoot, "shop")

    @AfterTest fun teardown() { coreRoot.deleteRecursively() }

    private fun template(version: Int = 1, menu: String = "title: Daily\n", seed: String? = null) =
        TemplateDeclaration.builder("daily", version)
            .file("quest_groups/daily.yaml", "key: daily\n".toByteArray())
            .file("menus/daily.yaml", menu.toByteArray())
            .apply { if (seed != null) seed(seed) }
            .build()

    @Test
    fun `a copy writes the files and records where they came from`() {
        val result = TemplateCopies.copy(project, "quests", template())
        assertEquals(listOf("quest_groups/daily.yml", "menus/daily.yml"), result.written)
        assertEquals("key: daily\n", File(project, "quest_groups/daily.yml").readText())

        val origins = ProjectOrigins.read(project)
        assertEquals(setOf("menus/daily.yml", "quest_groups/daily.yml"), origins.keys)
        val origin = origins.getValue("menus/daily.yml")
        assertEquals(FileOrigin("quests", "daily", 1, ContentHash.hashBytes("title: Daily\n".toByteArray())), origin)
    }

    @Test
    fun `the owner's edits are never overwritten unless asked`() {
        TemplateCopies.copy(project, "quests", template())
        File(project, "menus/daily.yml").writeText("title: Mine\n")

        val refused = TemplateCopies.copy(project, "quests", template(version = 2, menu = "title: Daily v2\n"))
        assertEquals(listOf("menus/daily.yml"), refused.conflicts)
        assertTrue(refused.written.isEmpty())
        assertEquals("title: Mine\n", File(project, "menus/daily.yml").readText())
        assertEquals(1, ProjectOrigins.read(project).getValue("quest_groups/daily.yml").version, "nothing recorded on a conflict")

        val replaced = TemplateCopies.copy(project, "quests", template(version = 2, menu = "title: Daily v2\n"), refused.conflicts, replace = true)
        assertEquals(listOf("menus/daily.yml"), replaced.written)
        assertEquals("title: Daily v2\n", File(project, "menus/daily.yml").readText())
        val origins = ProjectOrigins.read(project)
        assertEquals(2, origins.getValue("menus/daily.yml").version)
        assertEquals(1, origins.getValue("quest_groups/daily.yml").version, "a partial copy leaves the other origins alone")
    }

    @Test
    fun `a file already holding the shipped content is only recorded`() {
        File(project, "quest_groups").mkdirs()
        File(project, "quest_groups/daily.yaml").writeText("key: daily\n")
        val result = TemplateCopies.copy(project, "quests", template())
        assertEquals(listOf("menus/daily.yml"), result.written)
        assertEquals(listOf("quest_groups/daily.yaml"), result.unchanged)
        assertEquals(2, ProjectOrigins.read(project).size)
    }

    @Test
    fun `origins round-trip and ignore broken entries`() {
        val origins = mapOf("a.yaml" to FileOrigin("quests", "daily", 3, "h"))
        File(project, ".artisan").mkdirs()
        File(project, ProjectOrigins.PATH).writeBytes(ProjectOrigins.serialize(origins))
        assertEquals(origins, ProjectOrigins.read(project))

        File(project, ProjectOrigins.PATH).writeText("files:\n  a.yaml: {module: quests}\n  b.yaml: {module: q, template: t, version: 1, hash: h}\n")
        assertEquals(setOf("b.yaml"), ProjectOrigins.read(project).keys)
        File(project, ProjectOrigins.PATH).writeText(": not yaml [")
        assertTrue(ProjectOrigins.read(project).isEmpty())
    }

    @Test
    fun `a seed project is created once, and never again even when deleted`() {
        val roots = ProjectRoots(coreRoot)
        val seeds = TemplateSeeds(roots, defaultLang = { "fr_FR" })
        assertTrue(seeds.seed("quests", template(seed = "quests")))
        assertTrue(File(coreRoot, "quests/menus/daily.yml").isFile)
        assertEquals(
            "schema: module/v1\ndefault_lang: fr\nlanguages: [fr]\n",
            File(coreRoot, "quests/artisan-module.yml").readText(),
            "a template ships no manifest: the seed writes one in the server's language",
        )
        assertEquals(setOf("quests/daily"), seeds.seeded())

        File(coreRoot, "quests").deleteRecursively()
        assertFalse(seeds.seed("quests", template(version = 2, seed = "quests")))
        assertFalse(File(coreRoot, "quests").exists())
    }

    @Test
    fun `a seed never touches an existing project of that name`() {
        File(coreRoot, "quests").mkdirs()
        File(coreRoot, "quests/manifest.yaml").writeText("mine")
        val seeds = TemplateSeeds(ProjectRoots(coreRoot))
        assertFalse(seeds.seed("quests", template(seed = "quests")))
        assertEquals(listOf("manifest.yaml"), File(coreRoot, "quests").list()!!.toList())
        assertEquals(setOf("quests/daily"), seeds.seeded())
        assertFalse(seeds.seed("quests", template()), "a template without a seed project is never seeded")
    }

    @Test
    fun `a seed into the module's own folder writes its module file, the examples are originals`() {
        val roots = ProjectRoots(coreRoot)
        val dir = roots.moduleFolder("attribution", "attribution", null)
        val seeds = TemplateSeeds(roots, defaultLang = { "fr" })
        assertTrue(seeds.seed("attribution", template(seed = "attribution")))
        assertFalse(File(dir, "menus/daily.yml").exists(), "kept by SystemFiles, in originals/")
        assertEquals(dir, seeds.ownFolderSeed("attribution", template(seed = "attribution")))
        assertEquals("schema: module/v1\ndefault_lang: fr\nlanguages: [fr]\n", File(dir, "artisan-module.yml").readText())
        assertEquals(setOf("attribution/daily"), seeds.seeded())
    }

    @Test
    fun `a seed into the module's folder keeps what is already there`() {
        val roots = ProjectRoots(coreRoot)
        val dir = roots.moduleFolder("attribution", "attribution", null)
        File(dir, "manifest.yaml").writeText("mine")
        File(dir, "menus/daily.yaml").apply { parentFile.mkdirs(); writeText("edited") }
        val seeds = TemplateSeeds(roots)
        assertFalse(seeds.seed("attribution", template(seed = "attribution")))
        assertEquals("mine", File(dir, "manifest.yaml").readText())
        assertEquals("edited", File(dir, "menus/daily.yaml").readText())
        assertEquals(setOf("attribution/daily"), seeds.seeded())
    }

    @Test
    fun `another module's folder of that name is left alone`() {
        val roots = ProjectRoots(coreRoot)
        val dir = roots.moduleFolder("attribution", "other", null)
        assertFalse(TemplateSeeds(roots).seed("attribution", template(seed = "attribution")))
        assertTrue(dir.list()!!.none { !it.startsWith(".artisan") })
    }
}
