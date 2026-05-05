package gg.interfaze.plugin

import gg.interfaze.plugin.yaml.PackReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PackReaderTest {

    private fun writeTempPack(): File {
        val root = java.nio.file.Files.createTempDirectory("ifz_packs_").toFile()
        val packDir = File(root, "p_test").apply { mkdirs() }

        File(packDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            pack_id: p_test
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
        val packsRoot = writeTempPack()
        val bundles = PackReader(packsRoot).readAll()

        assertEquals(1, bundles.size)
        val bundle = bundles.first()
        assertEquals("p_test", bundle.packId)
        assertEquals("en", bundle.defaultLang)
        assertEquals(1, bundle.menus.size)
        assertNotNull(bundle.menus.first())
        assertEquals("m_shop", bundle.menus.first().id)
        assertEquals("Shop", bundle.menus.first().resolveTitle("en"))
    }

    @Test
    fun `resolveTitle for non-default lang`() {
        val packsRoot = writeTempPack()
        val bundle = PackReader(packsRoot).readAll().first()
        assertEquals("Boutique", bundle.menus.first().resolveTitle("fr"))
    }

    @Test
    fun `resolveTitle returns raw tag when lang file absent`() {
        val packsRoot = writeTempPack()
        val bundle = PackReader(packsRoot).readAll().first()
        assertEquals("{i18n:menus.m_shop.title}", bundle.menus.first().resolveTitle("de"))
    }
}
