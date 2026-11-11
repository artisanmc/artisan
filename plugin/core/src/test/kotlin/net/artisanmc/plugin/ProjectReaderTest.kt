package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.jupiter.api.assertThrows

class ProjectReaderTest {

    @Test
    fun `resolved root identity overrides a divergent legacy manifest`() {
        val root = writeTempProject()
        val manifest = File(root, "p_test/manifest.yaml")
        manifest.writeText(manifest.readText().replace("project_id: p_test", "project_id: stale"))
        assertEquals("p_test", ProjectReader(root).readAll().single().projectId)
    }

    @Test
    fun `addon registration remains identity without manifest project id`() {
        val root = writeTempProject()
        val dir = File(root, "p_test")
        val manifest = File(dir, "manifest.yaml")
        manifest.writeText(manifest.readText().replace("project_id: p_test", ""))
        val roots = net.artisanmc.plugin.project.ProjectRoots(File(root, "empty"))
        roots.register("boutique_addon", dir)
        assertEquals("boutique_addon", ProjectReader(roots).readAll().single().projectId)
    }

    @Test
    fun `legacy manifest identity is readable but never serialized`() {
        val mapper = com.fasterxml.jackson.databind.ObjectMapper(com.fasterxml.jackson.dataformat.yaml.YAMLFactory())
            .registerModule(com.fasterxml.jackson.module.kotlin.KotlinModule.Builder().build())
        val manifest = mapper.readValue("project_id: legacy\n", net.artisanmc.plugin.model.ManifestYaml::class.java)
        assertEquals("legacy", manifest.projectId)
        kotlin.test.assertFalse(mapper.writeValueAsString(manifest).contains("project_id"))
    }

    private fun writeTempProject(): File {
        val root = java.nio.file.Files.createTempDirectory("artisan_packs_").toFile()
        val projectDir = File(root, "p_test").apply { mkdirs() }

        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_test
            default_lang: en
            languages:
              - en
              - fr
            files:
              menus:
                - m_shop
              commands: []
        """.trimIndent())

        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/m_shop.yaml").writeText("""
            schema: menu/v1
            id: m_shop
            title: "{i18n:menus.m_shop.title}"
            size: 27
            layers:
              - id: l_default
                name: default
                elements: []
        """.trimIndent())

        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("menus.m_shop.title: Shop\n")
        File(projectDir, "lang/fr.yaml").writeText("menus.m_shop.title: Boutique\n")

        return root
    }

    /**
     * A LEGACY tree: item sets used to live in project-level `templates/<id>.yaml`
     * that elements bound to by ref. That model is gone — a set now lives on the
     * element that renders it. The editor migrates any such file away on import
     * and never writes one again, but a server whose disk still holds one must
     * keep working until it is re-saved, so the reader stays compatible.
     */
    private fun writeTemplateProject(): File {
        val root = java.nio.file.Files.createTempDirectory("artisan_tpl_").toFile()
        val projectDir = File(root, "p_tpl").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_tpl
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              templates: [tpl_view]
        """.trimIndent())
        File(projectDir, "templates").mkdirs()
        File(projectDir, "templates/tpl_view.yaml").writeText("""
            schema: template/v1
            id: tpl_view
            source: "boutique:items"
            alias: row
            key_field: id
            appearances:
              - material: "{row.icon}"
                title: "Item {row.name}"
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/shop.yaml").writeText("""
            schema: menu/v1
            id: shop
            title: []
            size: 54
            elements:
              - id: grid
                positions: 10-43
                iterates: { source: "boutique:items", template: tpl_view }
              - id: pins
                positions: 0
                places:
                  source: "boutique:items"
                  template: tpl_view
                  placements: [{ key: sword, page: 0, position: 10 }]
        """.trimIndent())
        return root
    }

    @Test
    fun `legacy template refs still resolve into effective elements at load`() {
        val runtime = ProjectReader(writeTemplateProject()).readAll().single()
        val menu = runtime.menus.single()
        val grid = menu.yaml.allElements.first { it.id == "grid" }
        val pins = menu.yaml.allElements.first { it.id == "pins" }
        // Template appearances injected + compiled; alias/key_field from the template.
        assertEquals("row", grid.iterates?.alias)
        assertEquals(0, grid.states.size)
        assertEquals("{row.icon}", grid.display.material)
        assertNotNull(menu.compiledAppearances["grid"])
        assertEquals("row", pins.places?.alias)
        assertEquals("id", pins.places?.keyField)
    }

    @Test
    fun `dangling legacy template ref keeps local fields (non-hermetic)`() {
        val root = writeTemplateProject()
        File(root, "p_tpl/templates/tpl_view.yaml").delete()
        val runtime = ProjectReader(root).readAll().single()
        val grid = runtime.menus.single().yaml.allElements.first { it.id == "grid" }
        assertNull(grid.display.material)
        assertEquals(0, grid.states.size)
    }

    @Test
    fun `reads manifest and resolves menu title for default lang`() {
        val projectsRoot = writeTempProject()
        val runtimes = ProjectReader(projectsRoot).readAll()

        assertEquals(1, runtimes.size)
        val runtime = runtimes.first()
        assertEquals("p_test", runtime.projectId)
        assertEquals("en", runtime.defaultLang)
        assertEquals(1, runtime.menus.size)
        assertNotNull(runtime.menus.first())
        assertEquals("m_shop", runtime.menus.first().id)
        assertEquals("Shop", runtime.menus.first().resolveTitle("en"))
    }

    @Test
    fun `resolveTitle for non-default lang`() {
        val projectsRoot = writeTempProject()
        val runtime = ProjectReader(projectsRoot).readAll().first()
        assertEquals("Boutique", runtime.menus.first().resolveTitle("fr"))
    }

    @Test
    fun `resolves a title from a NESTED lang file (canonical on-disk form)`() {
        val projectsRoot = writeTempProject()
        File(projectsRoot, "p_test/lang/en.yaml").writeText(
            """
            menus:
              m_shop:
                title: Shop
            """.trimIndent(),
        )
        val runtime = ProjectReader(projectsRoot).readAll().first()
        assertEquals("Shop", runtime.menus.first().resolveTitle("en"))
    }

    @Test
    fun `a broken lang file degrades to empty translations, the project still loads`() {
        val projectsRoot = writeTempProject()
        // Unterminated flow sequence — a plausible hand-edit typo.
        File(projectsRoot, "p_test/lang/en.yaml").writeText("menus: [oops\n")

        val runtimes = ProjectReader(projectsRoot).readAll()

        assertEquals(1, runtimes.size, "the project must load despite the unreadable lang file")
        val runtime = runtimes.first()
        assertEquals(1, runtime.menus.size)
        // No translation available → the raw tag, same as an absent lang file.
        assertEquals("{i18n:menus.m_shop.title}", runtime.menus.first().resolveTitle("en"))
        // The OTHER language is untouched.
        assertEquals("Boutique", runtime.menus.first().resolveTitle("fr"))
    }

    @Test
    fun `a lang file whose root is not a mapping degrades the same way`() {
        val projectsRoot = writeTempProject()
        File(projectsRoot, "p_test/lang/en.yaml").writeText("- a\n- b\n")

        val runtime = ProjectReader(projectsRoot).readAll().first()

        assertEquals(1, runtime.menus.size)
        assertEquals("{i18n:menus.m_shop.title}", runtime.menus.first().resolveTitle("en"))
        assertEquals("Boutique", runtime.menus.first().resolveTitle("fr"))
    }

    @Test
    fun `resolveTitle returns raw tag when lang file absent`() {
        val projectsRoot = writeTempProject()
        val runtime = ProjectReader(projectsRoot).readAll().first()
        assertEquals("{i18n:menus.m_shop.title}", runtime.menus.first().resolveTitle("de"))
    }

    @Test
    fun `reads Documents from themed folders and reports a duplicated id`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_folders_").toFile()
        val projectDir = File(root, "survie").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")
        fun write(rel: String, text: String) = File(projectDir, rel).apply { parentFile.mkdirs(); writeText(text) }
        write("menus/main.yaml", "schema: menu/v1\ntitle: Main\nrows: 1\n")
        write("boutique/menus/shop.yaml", "schema: menu/v1\ntitle: Shop\nrows: 1\n")
        write("boutique/armes/menus/swords.yaml", "schema: menu/v1\ntitle: Swords\nrows: 1\n")
        write("boutique/dialogs/welcome.yaml", "schema: dialog/v1\ntitle: Hi\n")
        write("quetes/menus/main.yaml", "schema: menu/v1\ntitle: Clash\nrows: 1\n")
        val skipped = mutableListOf<Pair<String, String>>()

        val runtime = ProjectReader(
            net.artisanmc.plugin.project.ProjectRoots(root),
            onSkip = { _, path, reason -> skipped += path to reason },
        ).readAll().single()

        assertEquals(listOf("shop", "swords"), runtime.menus.map { it.id })
        assertEquals(listOf("welcome"), runtime.dialogs.map { it.id })
        assertEquals(
            listOf("menus/main.yaml" to "duplicate_id", "quetes/menus/main.yaml" to "duplicate_id"),
            skipped,
        )
    }

    @Test
    fun `reads dialogs from manifest`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_dial_").toFile()
        val projectDir = File(root, "p_dial").apply { mkdirs() }

        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_dial
            default_lang: en
            languages:
              - en
            files:
              menus: []
              commands: []
              dialogs:
                - d_test
        """.trimIndent())

        File(projectDir, "dialogs").mkdirs()
        File(projectDir, "dialogs/d_test.yaml").writeText("""
            schema: dialog/v1
            id: d_test
            title: Test Dialog
            buttons:
              - id: btn_ok
                label: OK
                actions: close_dialog
        """.trimIndent())

        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("{}\n")

        val runtimes = ProjectReader(root).readAll()
        assertEquals(1, runtimes.size)
        val runtime = runtimes.first()
        assertEquals(1, runtime.dialogs.size)
        assertEquals("d_test", runtime.dialogs.first().id)
        assertEquals("Test Dialog", runtime.dialogs.first().yaml.title?.forLang("en", "en"))
    }

    @Test
    fun `manifest lore_max_width reaches every menu, absent means no wrap`() {
        val root = writeTempProject()
        assertEquals(0, ProjectReader(root).readAll().first().menus.first().loreMaxWidth)
        val manifest = File(root, "p_test/manifest.yaml")
        manifest.appendText("\nlore_max_width: 240\n")
        assertEquals(240, ProjectReader(root).readAll().first().menus.first().loreMaxWidth)
    }

    @Test
    fun `manifest escape_goes_back reaches every menu, absent means ESC closes`() {
        val root = writeTempProject()
        assertFalse(ProjectReader(root).readAll().first().menus.first().escapeGoesBack)
        File(root, "p_test/manifest.yaml").appendText("\nescape_goes_back: true\n")
        assertTrue(ProjectReader(root).readAll().first().menus.first().escapeGoesBack)
    }

    @Test
    fun `accepts menu YAML with explicit schema field menu_v1`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_schema_ok_").toFile()
        val projectDir = File(root, "test_pack").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            schema: "manifest/v1"
            project_id: test_pack
            default_lang: en
            languages: ["en"]
            files:
              menus: ["test"]
              commands: []
              dialogs: []
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/test.yaml").writeText("""
            schema: "menu/v1"
            id: test
            size: 27
            layers: []
        """.trimIndent())
        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("{}")

        val projects = ProjectReader(root).readAll()
        assertEquals(1, projects.size)
        assertEquals("test_pack", projects[0].projectId)
    }

    @Test
    fun `accepts menu YAML without schema field for backward compat`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_schema_legacy_").toFile()
        val projectDir = File(root, "legacy_pack").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            project_id: legacy_pack
            default_lang: en
            languages: ["en"]
            files:
              menus: ["legacy"]
              commands: []
              dialogs: []
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/legacy.yaml").writeText("""
            id: legacy
            size: 27
            layers: []
        """.trimIndent())
        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("{}")

        val projects = ProjectReader(root).readAll()
        assertEquals(1, projects.size)
        assertEquals("legacy_pack", projects[0].projectId)
    }

    /**
     * `menu/v2` and `menu/v3` shipped as pure version bumps — neither migration
     * touched the data — and were folded back into `menu/v1`. Projects written
     * while they existed are on servers' disks; they must keep loading.
     */
    @Test
    fun `accepts menu YAML still labelled with a retired version`() {
        for (version in listOf("menu/v2", "menu/v3")) {
            val root = java.nio.file.Files.createTempDirectory("artisan_schema_retired_").toFile()
            val projectDir = File(root, "retired_pack").apply { mkdirs() }
            File(projectDir, "manifest.yaml").writeText("""
                schema: "manifest/v1"
                project_id: retired_pack
                default_lang: en
                languages: ["en"]
                files:
                  menus: ["retired"]
                  commands: []
                  dialogs: []
            """.trimIndent())
            File(projectDir, "menus").mkdirs()
            File(projectDir, "menus/retired.yaml").writeText("""
                schema: "$version"
                id: retired
                size: 27
                elements:
                  - id: icon
                    positions: 0
                    item: "shop:diamond"
                    lore_mode: replace
            """.trimIndent())
            File(projectDir, "lang").mkdirs()
            File(projectDir, "lang/en.yaml").writeText("{}")

            val projects = ProjectReader(root).readAll()
            assertEquals(1, projects.size, "menu labelled $version should still load")
            assertEquals(1, projects[0].menus.size)
        }
    }

    @Test
    fun `rejects menu YAML with unsupported schema version`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_schema_bad_").toFile()
        val projectDir = File(root, "future_pack").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            project_id: future_pack
            default_lang: en
            languages: ["en"]
            files:
              menus: ["future"]
              commands: []
              dialogs: []
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/future.yaml").writeText("""
            schema: "menu/v99"
            id: future
            size: 27
            layers: []
        """.trimIndent())
        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("{}")

        assertThrows<IllegalArgumentException> {
            ProjectReader(root).readAll()
        }
    }

    @Test
    fun `missing dialog file is skipped gracefully`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_dial_skip_").toFile()
        val projectDir = File(root, "p_skip").apply { mkdirs() }

        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_skip
            default_lang: en
            languages: [en]
            files:
              menus: []
              commands: []
              dialogs:
                - d_ghost
        """.trimIndent())

        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("{}\n")

        val runtimes = ProjectReader(root).readAll()
        assertEquals(0, runtimes.first().dialogs.size)
    }

    @Test
    fun `an unparseable menu is skipped, the rest of the project still loads`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_tol_").toFile()
        val projectDir = File(root, "p_tol").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_tol
            default_lang: en
            languages: [en]
            files:
              menus:
                - m_ok
                - m_bad
              commands: []
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/m_ok.yaml").writeText("""
            schema: menu/v1
            id: m_ok
            title: "Shop"
            size: 27
            layers:
              - id: l
                name: default
                elements: []
        """.trimIndent())
        // Malformed content (here a String where `size` expects an Int; stands in
        // for e.g. a stale pre-Action-DSL menu whose steps are still an array).
        // A parse error must skip THIS file, not fail the whole reload + enable.
        File(projectDir, "menus/m_bad.yaml").writeText("""
            schema: menu/v1
            id: m_bad
            title: "Bad"
            size: "not-a-number"
            layers: []
        """.trimIndent())
        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("{}\n")

        val runtimes = ProjectReader(root).readAll()
        assertEquals(1, runtimes.size)
        assertEquals(1, runtimes.first().menus.size) // m_bad skipped, m_ok loaded
    }

    private fun tolerantProject(prefix: String): Pair<File, File> {
        val root = java.nio.file.Files.createTempDirectory(prefix).toFile()
        val projectDir = File(root, "p_a").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            default_lang: en
            languages: [en]
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/m_ok.yaml").writeText("""
            schema: menu/v1
            size: 27
            elements:
              - id: e
                positions: 0
        """.trimIndent())
        return root to projectDir
    }

    @Test
    fun `a positions typo in one menu skips nothing else, never fails the reload`() {
        val (root, projectDir) = tolerantProject("artisan_pos_typo_")
        File(projectDir, "menus/m_typo.yaml").writeText("""
            schema: menu/v1
            size: 27
            elements:
              - id: e
                positions: "3, 10-"
        """.trimIndent())
        File(root, "p_b/menus").mkdirs()
        File(root, "p_b/manifest.yaml").writeText("schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")

        val runtimes = ProjectReader(root).readAll()
        assertEquals(setOf("p_a", "p_b"), runtimes.map { it.projectId }.toSet())
        val typo = runtimes.single { it.projectId == "p_a" }.menus.single { it.yaml.id == "m_typo" }
        assertEquals(setOf(3), typo.slotToElement.keys) // the bad range alone is dropped
    }

    @Test
    fun `a data source with an unsupported schema version is loud, like a Document`() {
        val (root, projectDir) = tolerantProject("artisan_ds_schema_")
        File(projectDir, "data").mkdirs()
        File(projectDir, "data/items.yaml").writeText("schema: data/v99\nshape: table\nrows: []\n")
        assertThrows<net.artisanmc.plugin.yaml.UnsupportedSchemaException> { ProjectReader(root).readAll() }
    }

    @Test
    fun `a per-row source whose _source yaml has an unsupported schema version is loud`() {
        val (root, projectDir) = tolerantProject("artisan_ds_rows_schema_")
        File(projectDir, "data/items").mkdirs()
        File(projectDir, "data/items/_source.yaml").writeText("schema: data/v99\n")
        File(projectDir, "data/items/a.yaml").writeText("id: a\n")
        assertThrows<net.artisanmc.plugin.yaml.UnsupportedSchemaException> { ProjectReader(root).readAll() }
    }
}
