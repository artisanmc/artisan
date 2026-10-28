package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class SyncedMenuProviderTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: ArtisanPlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
    }

    @AfterTest
    fun teardown() {
        MockBukkit.unmock()
    }

    private fun writePackFixture(packsRoot: File) {
        val projectDir = File(packsRoot, "p_test").apply { mkdirs() }
        File(projectDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            project_id: p_test
            default_lang: en
            languages: [en]
            files:
              menus: [m_shop]
              commands: []
        """.trimIndent())
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/m_shop.yaml").writeText("""
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
                    material: PAPER
                    title: "{i18n:menus.m_shop.elements.el_btn.default.title}"
        """.trimIndent())
        File(projectDir, "lang").mkdirs()
        File(projectDir, "lang/en.yaml").writeText("""
            menus.m_shop.title: Shop
            menus.m_shop.elements.el_btn.default.title: Buy
        """.trimIndent())
    }

    @Test
    fun `resolves menu by id from disk`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        writePackFixture(packsRoot)
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null)
        provider.load()
        val menu = provider.findMenu("m_shop")
        assertNotNull(menu)
        assertEquals("Shop", menu.resolveTitle("en"))
    }

    @Test
    fun `openMenu creates a 27-slot inventory for the player`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        writePackFixture(packsRoot)
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null)
        provider.load()
        val player = server.addPlayer()
        provider.openMenu(player, "m_shop", "en")
        assertNotNull(player.openInventory)
        assertEquals(27, player.openInventory.topInventory.size)
    }

    /** Two projects each carrying a `main` menu, with different sizes to tell them apart. */
    private fun writeTwoProjectsWithSameMenuId(root: File) {
        for ((project, size) in listOf("core" to 27, "shop" to 54)) {
            val dir = File(root, project).apply { mkdirs() }
            File(dir, "manifest.yaml").writeText("schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")
            File(dir, "menus").mkdirs()
            File(dir, "menus/main.yaml").writeText("schema: menu/v1\nsize: $size\nelements: []\n")
        }
    }

    private fun twoProjectProvider(): SyncedMenuProvider {
        val root = Files.createTempDirectory("artisan_ns_").toFile()
        writeTwoProjectsWithSameMenuId(root)
        return SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(root), logger = null)
            .also { it.load() }
    }

    @Test
    fun `a qualified ref finds the menu of that project`() {
        val menu = twoProjectProvider().findMenu("shop:main")
        assertNotNull(menu)
        assertEquals(54, menu.yaml.size)
        assertEquals("shop", menu.projectId)
    }

    @Test
    fun `a bare id opens the menu of the project the action comes from`() {
        val provider = twoProjectProvider()
        val player = server.addPlayer()
        provider.openMenu(player, "main", "en", net.artisanmc.plugin.engine.ExecutionContext(player, projectId = "shop"))
        assertEquals(54, player.openInventory.topInventory.size)
        provider.openMenu(player, "main", "en", net.artisanmc.plugin.engine.ExecutionContext(player, projectId = "core"))
        assertEquals(27, player.openInventory.topInventory.size)
    }

    @Test
    fun `an ambiguous bare id still opens a menu, as before namespaces`() {
        val provider = twoProjectProvider()
        val player = server.addPlayer()
        provider.openMenu(player, "main", "en")
        assertNotNull(player.openInventory)
        assertTrue(player.openInventory.topInventory.size in setOf(27, 54))
    }

    @Test
    fun `no WsClient created without a hub`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null)
        provider.load()
        provider.unload()  // must not throw
    }

    @Test
    fun `unload preserves httpClient executor (reload safety)`() {
        // Regression: pre-fix unload() called executorService.shutdown(), which broke
        // every subsequent download after /artisan reload because the executor is
        // shared across load/unload cycles. After the fix, only shutdown() may stop it.
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null)
        provider.load()
        provider.unload()
        val httpField = SyncedMenuProvider::class.java.getDeclaredField("httpClient").apply { isAccessible = true }
        val client = httpField.get(provider) as okhttp3.OkHttpClient
        assertFalse(
            client.dispatcher.executorService.isShutdown,
            "unload() must not shut down the httpClient executor — that breaks downloads after /artisan reload",
        )
    }

    @Test
    fun `shutdown tears down httpClient executor`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null)
        provider.load()
        provider.shutdown()
        val httpField = SyncedMenuProvider::class.java.getDeclaredField("httpClient").apply { isAccessible = true }
        val client = httpField.get(provider) as okhttp3.OkHttpClient
        assertTrue(client.dispatcher.executorService.isShutdown)
    }

    @Test
    fun `provider forwards resource_pack_updated to manager`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val mgr = ResourcePackManager(plugin, ResourcePackConfig(delegateToDir = null, delegateReloadCommand = null))
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null, resourcePackManager = mgr)
        provider.load()
        val hash = "0".repeat(40)
        val raw = """{"type":"resource_pack_updated","url":"http://x/$hash.zip","hash":"$hash"}"""
        val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
        handle.isAccessible = true
        handle.invoke(provider, raw)
        assertEquals(hash, mgr.currentPackInfo?.hash)
    }

    @Test
    fun `provider applies resource_pack from hello_ack`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val mgr = ResourcePackManager(plugin, ResourcePackConfig(delegateToDir = null, delegateReloadCommand = null))
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null, resourcePackManager = mgr)
        provider.load()
        val hash = "f".repeat(40)
        val raw = """{"type":"hello_ack","session_id":"s","resource_pack":{"url":"http://x/$hash.zip","hash":"$hash"}}"""
        val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
        handle.isAccessible = true
        handle.invoke(provider, raw)
        assertEquals(hash, mgr.currentPackInfo?.hash)
    }

    @Test
    fun `a leaf downloads the hub pack through the hub address it joined`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val mgr = ResourcePackManager(plugin, ResourcePackConfig(delegateToDir = null, delegateReloadCommand = null))
        val provider = SyncedMenuProvider(
            net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null, resourcePackManager = mgr,
            hub = net.artisanmc.plugin.ws.HubLink("ws://hub:8765/ws/plugin", "secret", "survie"),
        )
        val hash = "b".repeat(40)
        provider.handleMessageForTesting("""{"type":"resource_pack_updated","url":"http://localhost:8765/api/v1/resource-pack/$hash.zip","hash":"$hash"}""")
        val info = mgr.currentPackInfo
        assertNotNull(info)
        assertEquals("http://localhost:8765/api/v1/resource-pack/$hash.zip", info.url)
        assertEquals("http://hub:8765/api/v1/resource-pack/$hash.zip", info.downloadUrl)
    }

    @Test
    fun `resolvePluginDownloadUrl falls back to player URL without a hub`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null)
        provider.load()
        val resolved = provider.resolvePluginDownloadUrl("http://localhost:3001/api/v1/resource-pack/x.zip")
        assertEquals("http://localhost:3001/api/v1/resource-pack/x.zip", resolved)
    }

    @Test
    fun `provider clears the resource pack when hello_ack resource_pack is null`() {
        val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
        val mgr = ResourcePackManager(plugin, ResourcePackConfig(delegateToDir = null, delegateReloadCommand = null))
        mgr.onUpdate(ResourcePackInfo.from("http://stale", "a".repeat(40)))
        val provider = SyncedMenuProvider(net.artisanmc.plugin.project.ProjectRoots(packsRoot), logger = null, resourcePackManager = mgr)
        provider.load()
        val raw = """{"type":"hello_ack","session_id":"s","resource_pack":null}"""
        val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
        handle.isAccessible = true
        handle.invoke(provider, raw)
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `reload asks made before the read starts make one reload`() {
        val root = Files.createTempDirectory("artisan_coalesce_").toFile()
        writeTwoProjectsWithSameMenuId(root)
        val roots = net.artisanmc.plugin.project.ProjectRoots(root)
        val queued = ArrayDeque<Runnable>()
        val reloads = mutableListOf<Set<String>?>()
        val provider = SyncedMenuProvider(
            roots, logger = null,
            onReload = { modules -> reloads += modules },
            reloadExecutor = { queued.addLast(it) },
        )
        provider.load()
        queued.clear()
        reloads.clear()

        val shop = Files.createTempDirectory("artisan_shop_").toFile()
        val quests = Files.createTempDirectory("artisan_quests_").toFile()
        for (dir in listOf(shop, quests)) {
            File(dir, "manifest.yaml").writeText("schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")
            File(dir, "menus").mkdirs()
            File(dir, "menus/shop.yaml").writeText("schema: menu/v1\nsize: 9\nelements: []\n")
        }
        // Changed on disk but not registered: a folder registration reads that folder only.
        File(root, "core/menus/main.yaml").writeText("schema: menu/v1\nsize: 9\nelements: []\n")
        roots.register("boutique_addon", shop, "boutique")
        roots.register("quests", quests, "quests")
        assertEquals(1, queued.size, "the folders registered together make one reload")
        queued.removeFirst().run()
        assertEquals(listOf<Set<String>?>(setOf("boutique", "quests")), reloads, "only the folders' modules are notified")
        assertEquals(listOf("boutique_addon", "core", "quests", "shop"), provider.runtimeProjects().map { it.projectId })
        assertEquals(27, provider.findMenu("core:main")?.yaml?.size, "the other projects keep what the last reload read")
        assertNotNull(provider.findMenu("boutique_addon:shop"))

        provider.refreshFromDisk()
        provider.refreshFromDisk()
        assertEquals(1, queued.size)
        queued.removeFirst().run()
        assertEquals(null, reloads.last(), "an explicit reload notifies every module")
    }
}
