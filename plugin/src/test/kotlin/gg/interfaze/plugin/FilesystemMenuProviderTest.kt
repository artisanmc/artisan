package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import gg.interfaze.plugin.provider.FilesystemMenuProvider
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class FilesystemMenuProviderTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: InterfazePlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
    }

    @AfterTest
    fun teardown() {
        MockBukkit.unmock()
    }

    private fun writePackFixture(packsRoot: File) {
        val packDir = File(packsRoot, "p_test").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            pack_id: p_test
            default_lang: en
            languages: [en]
            files:
              menus: [m_shop]
              commands: []
        """.trimIndent())
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m_shop.yaml").writeText("""
            schema: menu/v1
            id: m_shop
            title: "{i18n:menus.m_shop.title}"
            size: 27
            layers:
              - id: l_def
                name: default
                elements:
                  - id: el_btn
                    positions: "13"
                    appearances:
                      - material: PAPER
                        title: "{i18n:menus.m_shop.elements.el_btn.default.title}"
        """.trimIndent())
        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("""
            menus.m_shop.title: Shop
            menus.m_shop.elements.el_btn.default.title: Buy
        """.trimIndent())
    }

    @Test
    fun `resolves menu by id`() {
        val packsRoot = Files.createTempDirectory("ifz_packs_").toFile()
        writePackFixture(packsRoot)
        val provider = FilesystemMenuProvider(packsRoot)
        provider.load()
        val menu = provider.findMenu("m_shop")
        assertNotNull(menu)
        assertEquals("Shop", menu.resolveTitle("en"))
    }

    @Test
    fun `openMenu creates a 27-slot inventory for the player`() {
        val packsRoot = Files.createTempDirectory("ifz_packs_").toFile()
        writePackFixture(packsRoot)
        val provider = FilesystemMenuProvider(packsRoot)
        provider.load()
        val player = server.addPlayer()
        provider.openMenu(player, "m_shop", "en")
        assertNotNull(player.openInventory)
        assertEquals(27, player.openInventory.topInventory.size)
    }
}
