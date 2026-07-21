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
}
