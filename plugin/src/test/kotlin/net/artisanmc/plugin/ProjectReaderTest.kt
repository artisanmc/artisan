package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import org.junit.jupiter.api.assertThrows

class ProjectReaderTest {

    private fun writeTempPack(): File {
        val root = java.nio.file.Files.createTempDirectory("artisan_packs_").toFile()
        val packDir = File(root, "p_test").apply { mkdirs() }

        File(packDir, "manifest.yaml").writeText("""
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

        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m_shop.yaml").writeText("""
            schema: menu/v1
            id: m_shop
            title: "{i18n:menus.m_shop.title}"
            size: 27
            layers:
              - id: l_default
                name: default
                elements: []
        """.trimIndent())

        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("menus.m_shop.title: Shop\n")
        File(packDir, "lang/fr.yaml").writeText("menus.m_shop.title: Boutique\n")

        return root
    }

    private fun writeTemplatePack(): File {
        val root = java.nio.file.Files.createTempDirectory("artisan_tpl_").toFile()
        val packDir = File(root, "p_tpl").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_tpl
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              templates: [tpl_view]
        """.trimIndent())
        File(packDir, "templates").mkdirs()
        File(packDir, "templates/tpl_view.yaml").writeText("""
            schema: template/v1
            id: tpl_view
            source: "boutique:items"
            alias: row
            key_field: id
            appearances:
              - material: "{row.icon}"
                title: "Item {row.name}"
        """.trimIndent())
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/shop.yaml").writeText("""
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
    fun `template refs resolve into effective elements at load`() {
        val bundle = ProjectReader(writeTemplatePack()).readAll().single()
        val menu = bundle.menus.single()
        val grid = menu.yaml.allElements.first { it.id == "grid" }
        val pins = menu.yaml.allElements.first { it.id == "pins" }
        // Template appearances injected + compiled; alias/key_field from the template.
        assertEquals("row", grid.iterates?.alias)
        assertEquals(1, grid.appearances.size)
        assertEquals("{row.icon}", grid.appearances[0].material)
        assertNotNull(menu.compiledAppearances["grid"])
        assertEquals("row", pins.places?.alias)
        assertEquals("id", pins.places?.keyField)
    }

    @Test
    fun `dangling template ref keeps local fields (non-hermetic)`() {
        val root = writeTemplatePack()
        File(root, "p_tpl/templates/tpl_view.yaml").delete()
        val bundle = ProjectReader(root).readAll().single()
        val grid = bundle.menus.single().yaml.allElements.first { it.id == "grid" }
        assertEquals(0, grid.appearances.size)
    }

    @Test
    fun `reads manifest and resolves menu title for default lang`() {
        val projectsRoot = writeTempPack()
        val bundles = ProjectReader(projectsRoot).readAll()

        assertEquals(1, bundles.size)
        val bundle = bundles.first()
        assertEquals("p_test", bundle.projectId)
        assertEquals("en", bundle.defaultLang)
        assertEquals(1, bundle.menus.size)
        assertNotNull(bundle.menus.first())
        assertEquals("m_shop", bundle.menus.first().id)
        assertEquals("Shop", bundle.menus.first().resolveTitle("en"))
    }

    @Test
    fun `resolveTitle for non-default lang`() {
        val projectsRoot = writeTempPack()
        val bundle = ProjectReader(projectsRoot).readAll().first()
        assertEquals("Boutique", bundle.menus.first().resolveTitle("fr"))
    }

    @Test
    fun `resolves a title from a NESTED lang file (canonical on-disk form)`() {
        val projectsRoot = writeTempPack()
        File(projectsRoot, "p_test/lang/en.yaml").writeText(
            """
            menus:
              m_shop:
                title: Shop
            """.trimIndent(),
        )
        val bundle = ProjectReader(projectsRoot).readAll().first()
        assertEquals("Shop", bundle.menus.first().resolveTitle("en"))
    }

    @Test
    fun `resolveTitle returns raw tag when lang file absent`() {
        val projectsRoot = writeTempPack()
        val bundle = ProjectReader(projectsRoot).readAll().first()
        assertEquals("{i18n:menus.m_shop.title}", bundle.menus.first().resolveTitle("de"))
    }

    @Test
    fun `reads dialogs from manifest`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_dial_").toFile()
        val packDir = File(root, "p_dial").apply { mkdirs() }

        File(packDir, "manifest.yaml").writeText("""
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

        File(packDir, "dialogs").mkdirs()
        File(packDir, "dialogs/d_test.yaml").writeText("""
            schema: dialog/v1
            id: d_test
            title: Test Dialog
            buttons:
              - id: btn_ok
                label: OK
                actions: close_dialog
        """.trimIndent())

        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("{}\n")

        val bundles = ProjectReader(root).readAll()
        assertEquals(1, bundles.size)
        val bundle = bundles.first()
        assertEquals(1, bundle.dialogs.size)
        assertEquals("d_test", bundle.dialogs.first().id)
        assertEquals("Test Dialog", bundle.dialogs.first().yaml.title)
    }

    @Test
    fun `accepts menu YAML with explicit schema field menu_v1`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_schema_ok_").toFile()
        val packDir = File(root, "test_pack").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
            schema: "manifest/v1"
            project_id: test_pack
            default_lang: en
            languages: ["en"]
            files:
              menus: ["test"]
              commands: []
              dialogs: []
        """.trimIndent())
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/test.yaml").writeText("""
            schema: "menu/v1"
            id: test
            size: 27
            layers: []
        """.trimIndent())
        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("{}")

        val packs = ProjectReader(root).readAll()
        assertEquals(1, packs.size)
        assertEquals("test_pack", packs[0].projectId)
    }

    @Test
    fun `accepts menu YAML without schema field for backward compat`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_schema_legacy_").toFile()
        val packDir = File(root, "legacy_pack").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
            project_id: legacy_pack
            default_lang: en
            languages: ["en"]
            files:
              menus: ["legacy"]
              commands: []
              dialogs: []
        """.trimIndent())
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/legacy.yaml").writeText("""
            id: legacy
            size: 27
            layers: []
        """.trimIndent())
        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("{}")

        val packs = ProjectReader(root).readAll()
        assertEquals(1, packs.size)
        assertEquals("legacy_pack", packs[0].projectId)
    }

    @Test
    fun `rejects menu YAML with unsupported schema version`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_schema_bad_").toFile()
        val packDir = File(root, "future_pack").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
            project_id: future_pack
            default_lang: en
            languages: ["en"]
            files:
              menus: ["future"]
              commands: []
              dialogs: []
        """.trimIndent())
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/future.yaml").writeText("""
            schema: "menu/v99"
            id: future
            size: 27
            layers: []
        """.trimIndent())
        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("{}")

        assertThrows<IllegalArgumentException> {
            ProjectReader(root).readAll()
        }
    }

    @Test
    fun `missing dialog file is skipped gracefully`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_dial_skip_").toFile()
        val packDir = File(root, "p_skip").apply { mkdirs() }

        File(packDir, "manifest.yaml").writeText("""
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

        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("{}\n")

        val bundles = ProjectReader(root).readAll()
        assertEquals(0, bundles.first().dialogs.size)
    }

    @Test
    fun `an unparseable menu is skipped, the rest of the project still loads`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_tol_").toFile()
        val packDir = File(root, "p_tol").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
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
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m_ok.yaml").writeText("""
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
        File(packDir, "menus/m_bad.yaml").writeText("""
            schema: menu/v1
            id: m_bad
            title: "Bad"
            size: "not-a-number"
            layers: []
        """.trimIndent())
        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("{}\n")

        val bundles = ProjectReader(root).readAll()
        assertEquals(1, bundles.size)
        assertEquals(1, bundles.first().menus.size) // m_bad skipped, m_ok loaded
    }
}
