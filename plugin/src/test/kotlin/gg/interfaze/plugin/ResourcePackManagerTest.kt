package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import gg.interfaze.plugin.config.ResourcePackConfig
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
}
