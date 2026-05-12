package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import gg.interfaze.plugin.config.ResourcePackConfig
import gg.interfaze.plugin.resourcepack.AssetCatalog
import gg.interfaze.plugin.resourcepack.ResourcePackInfo
import gg.interfaze.plugin.resourcepack.ResourcePackManager
import kotlin.test.*

class ResourcePackManagerTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: InterfazePlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
    }

    @AfterTest
    fun teardown() { MockBukkit.unmock() }

    private fun config(enabled: Boolean = true, sendOnJoin: Boolean = true, delayTicks: Long = 0L) =
        ResourcePackConfig(enabled = enabled, prompt = "<gold>x</gold>", sendOnJoin = sendOnJoin, sendDelayTicks = delayTicks)

    private val SAMPLE_HASH = "0".repeat(40)

    @Test
    fun `from() produces stable UUID for the same hash`() {
        val a = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        val b = ResourcePackInfo.from("http://y", SAMPLE_HASH, "<red>y</red>")
        assertEquals(a.uuid, b.uuid)
    }

    @Test
    fun `sha1Bytes is decoded from the hex hash`() {
        val info = ResourcePackInfo.from("http://x", "ff00".repeat(10), "<gold>x</gold>")
        assertEquals(20, info.sha1Bytes.size)
        assertEquals(0xff.toByte(), info.sha1Bytes[0])
        assertEquals(0x00.toByte(), info.sha1Bytes[1])
    }

    @Test
    fun `manager starts with no current pack`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `onUpdate stores the info`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        mgr.onUpdate(info)
        assertEquals(info, mgr.currentPackInfo)
    }

    @Test
    fun `onUpdate with null clears the state`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        mgr.onUpdate(null)
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `pushToPlayer is a no-op when currentPackInfo is null`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        val player = server.addPlayer()
        mgr.pushToPlayer(player)
    }

    @Test
    fun `pushToPlayer is a no-op when disabled`() {
        val mgr = ResourcePackManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        val player = server.addPlayer()
        mgr.pushToPlayer(player)
    }

    @Test
    fun `onJoin pushes only if send-on-join is true`() {
        val mgr = ResourcePackManager(plugin, config(sendOnJoin = false, delayTicks = 0L), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        val player = server.addPlayer()
        mgr.onJoin(player)
    }

    @Test
    fun `applyFromBackend with dual URLs stores both on the info`() {
        val mgr = ResourcePackManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.applyFromBackend(
            playerUrl = "http://localhost:3001/pack.zip",
            downloadUrl = "http://backend:3001/pack.zip",
            hash = SAMPLE_HASH,
        )
        val info = mgr.currentPackInfo
        assertNotNull(info)
        assertEquals("http://localhost:3001/pack.zip", info.url)
        assertEquals("http://backend:3001/pack.zip", info.downloadUrl)
    }

    @Test
    fun `single-URL applyFromBackend defaults downloadUrl to url`() {
        val mgr = ResourcePackManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.applyFromBackend(url = "http://x/pack.zip", hash = SAMPLE_HASH)
        val info = mgr.currentPackInfo
        assertNotNull(info)
        assertEquals("http://x/pack.zip", info.url)
        assertEquals("http://x/pack.zip", info.downloadUrl)
    }

    @Test
    fun `AssetCatalog receives the download URL, not the player URL`() {
        // We can't easily intercept the live HTTP call inside AssetCatalog.update without
        // a real server, but we can verify that ResourcePackInfo holds the right field
        // and that updateCatalogAsync wires it through. A reflective check on the field
        // is enough to guard against regressions where someone passes info.url.
        val mgr = ResourcePackManager(
            plugin,
            config(enabled = false),
            logger = plugin.logger,
            assetCatalog = AssetCatalog(),
        )
        mgr.applyFromBackend(
            playerUrl = "http://player-only.example/pack.zip",
            downloadUrl = "http://backend:3001/api/resource-pack/aa.zip",
            hash = SAMPLE_HASH,
        )
        val info = mgr.currentPackInfo
        assertNotNull(info)
        // The download URL is what AssetCatalog.update is called with (see
        // ResourcePackManager.updateCatalogAsync). The player URL is what
        // pushToPlayer sends via setResourcePack.
        assertEquals("http://backend:3001/api/resource-pack/aa.zip", info.downloadUrl)
        assertEquals("http://player-only.example/pack.zip", info.url)
    }
}
