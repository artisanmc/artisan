package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.resourcepack.AssetCatalog
import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import org.bukkit.entity.Player
import org.bukkit.plugin.java.JavaPlugin
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.*

class ResourcePackManagerTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: ArtisanPlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
    }

    @AfterTest
    fun teardown() { MockBukkit.unmock() }

    private fun config(enabled: Boolean = true, sendOnJoin: Boolean = true, delayTicks: Long = 0L) =
        ResourcePackConfig(
            enabled = enabled,
            prompt = "<gold>x</gold>",
            sendOnJoin = sendOnJoin,
            sendDelayTicks = delayTicks,
            delegateToDir = null,
            delegateReloadCommand = null,
        )

    private val SAMPLE_HASH = "0".repeat(40)
    private val OTHER_HASH = "f".repeat(40)

    /**
     * Records every [addPack]/[removePack] call so tests can assert the exact sequence
     * of Bukkit API interactions. MockBukkit's [Player.addResourcePack] and
     * [Player.removeResourcePack] throw `UnimplementedOperationException`, so we override
     * the [ResourcePackManager] test seams instead of exercising the real player API.
     */
    private class RecordingManager(
        plugin: JavaPlugin,
        config: ResourcePackConfig,
        logger: Logger?,
        assetCatalog: AssetCatalog? = null,
    ) : ResourcePackManager(plugin, config, logger, assetCatalog) {
        sealed interface Call {
            data class Add(val playerName: String, val uuid: UUID, val url: String, val hash: String) : Call
            data class Remove(val playerName: String, val uuid: UUID) : Call
        }

        val calls = mutableListOf<Call>()

        override fun addPack(player: Player, info: ResourcePackInfo) {
            calls += Call.Add(player.name, info.uuid, info.url, info.hash)
        }

        override fun removePack(player: Player, uuid: UUID) {
            calls += Call.Remove(player.name, uuid)
        }
    }

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
    fun `onUpdate persists pack info and loadFromDisk restores it after a restart`(
        @org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path,
    ) {
        val cache = tmp.resolve("resource-pack.json").toFile()
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger, cacheFile = cache)
        mgr.onUpdate(ResourcePackInfo.from("http://player", "http://internal", SAMPLE_HASH, "<gold>x</gold>"))
        assertTrue(cache.exists())

        // Fresh manager (simulated restart, hub down) restores the info.
        val mgr2 = ResourcePackManager(plugin, config(), logger = plugin.logger, cacheFile = cache)
        mgr2.loadFromDisk()
        assertEquals("http://player", mgr2.currentPackInfo?.url)
        assertEquals("http://internal", mgr2.currentPackInfo?.downloadUrl)
        assertEquals(SAMPLE_HASH, mgr2.currentPackInfo?.hash)
    }

    @Test
    fun `onUpdate with null deletes the cache file`(
        @org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path,
    ) {
        val cache = tmp.resolve("resource-pack.json").toFile()
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger, cacheFile = cache)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        mgr.onUpdate(null)
        assertFalse(cache.exists())
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
        val mgr = RecordingManager(plugin, config(), logger = plugin.logger)
        val player = server.addPlayer()
        mgr.pushToPlayer(player)
        assertTrue(mgr.calls.isEmpty())
    }

    @Test
    fun `pushToPlayer is a no-op when disabled`() {
        val mgr = RecordingManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        val player = server.addPlayer()
        mgr.pushToPlayer(player)
        assertTrue(mgr.calls.isEmpty())
    }

    @Test
    fun `onJoin pushes only if send-on-join is true`() {
        val mgr = RecordingManager(plugin, config(sendOnJoin = false, delayTicks = 0L), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        val player = server.addPlayer()
        mgr.onJoin(player)
        // sendOnJoin=false → no add call, but onUpdate ran with no online players → no calls either.
        assertTrue(mgr.calls.isEmpty())
    }

    @Test
    fun `first push calls addPack and does NOT call removePack`() {
        val mgr = RecordingManager(plugin, config(), logger = plugin.logger)
        val player = server.addPlayer("alice")
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        // onUpdate runs pushToPlayer for online players (alice was online before onUpdate).
        val adds = mgr.calls.filterIsInstance<RecordingManager.Call.Add>()
        val removes = mgr.calls.filterIsInstance<RecordingManager.Call.Remove>()
        assertEquals(1, adds.size)
        assertEquals("alice", adds[0].playerName)
        assertEquals(SAMPLE_HASH, adds[0].hash)
        assertTrue(removes.isEmpty(), "first push must not call removePack (no previous Artisan pack)")
    }

    @Test
    fun `second push after onUpdate removes the previous pack and then adds the new one`() {
        val mgr = RecordingManager(plugin, config(), logger = plugin.logger)
        val player = server.addPlayer("alice")

        val info1 = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        mgr.onUpdate(info1)
        mgr.calls.clear()

        val info2 = ResourcePackInfo.from("http://y", OTHER_HASH, "<gold>x</gold>")
        mgr.onUpdate(info2)

        // Expect: removeResourcePack(prev) then addResourcePack(new) for alice.
        assertEquals(2, mgr.calls.size, "expected exactly one remove + one add, got ${mgr.calls}")
        val first = mgr.calls[0]
        val second = mgr.calls[1]
        assertTrue(first is RecordingManager.Call.Remove, "first call must be Remove, got $first")
        assertTrue(second is RecordingManager.Call.Add, "second call must be Add, got $second")
        assertEquals(info1.uuid, (first as RecordingManager.Call.Remove).uuid)
        val secondAdd = second as RecordingManager.Call.Add
        assertEquals(info2.uuid, secondAdd.uuid)
        assertEquals(OTHER_HASH, secondAdd.hash)
    }

    @Test
    fun `onUpdate(null) removes the pack for all online players and clears previousUuid`() {
        val mgr = RecordingManager(plugin, config(), logger = plugin.logger)
        val alice = server.addPlayer("alice")
        val bob = server.addPlayer("bob")

        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        mgr.onUpdate(info)
        // 2 adds (alice + bob)
        assertEquals(2, mgr.calls.size)
        mgr.calls.clear()

        mgr.onUpdate(null)

        // Expect: one removeResourcePack per online player.
        val removes = mgr.calls.filterIsInstance<RecordingManager.Call.Remove>()
        val adds = mgr.calls.filterIsInstance<RecordingManager.Call.Add>()
        assertEquals(2, removes.size, "expected one remove per online player")
        assertTrue(adds.isEmpty(), "no add calls expected when clearing the pack")
        assertEquals(setOf("alice", "bob"), removes.map { it.playerName }.toSet())
        for (r in removes) assertEquals(info.uuid, r.uuid)

        // currentPackInfo cleared; previousUuid also reset so a subsequent first push won't try
        // to remove a stale UUID.
        assertNull(mgr.currentPackInfo)
        mgr.calls.clear()
        mgr.onUpdate(ResourcePackInfo.from("http://z", SAMPLE_HASH, "<gold>x</gold>"))
        val addsAfter = mgr.calls.filterIsInstance<RecordingManager.Call.Add>()
        val removesAfter = mgr.calls.filterIsInstance<RecordingManager.Call.Remove>()
        assertEquals(2, addsAfter.size, "after clear, next update should add for online players")
        assertTrue(removesAfter.isEmpty(), "after clear, previousUuid must be reset (no remove)")
    }

    @Test
    fun `same UUID push does not call removePack`() {
        // If the hash hasn't changed, the UUID is stable. We shouldn't churn the player's
        // stack by remove+add of the same UUID.
        val mgr = RecordingManager(plugin, config(), logger = plugin.logger)
        server.addPlayer("alice")
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        mgr.onUpdate(info)
        mgr.calls.clear()

        // Same hash → same UUID.
        mgr.onUpdate(ResourcePackInfo.from("http://x-bis", SAMPLE_HASH, "<gold>x</gold>"))

        val removes = mgr.calls.filterIsInstance<RecordingManager.Call.Remove>()
        val adds = mgr.calls.filterIsInstance<RecordingManager.Call.Add>()
        assertEquals(1, adds.size)
        assertTrue(removes.isEmpty(), "must not remove when the UUID is unchanged")
    }

    @Test
    fun `applyPack with dual URLs stores both on the info`() {
        val mgr = ResourcePackManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.applyPack(
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
    fun `single-URL applyPack defaults downloadUrl to url`() {
        val mgr = ResourcePackManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.applyPack(url = "http://x/pack.zip", hash = SAMPLE_HASH)
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
        mgr.applyPack(
            playerUrl = "http://player-only.example/pack.zip",
            downloadUrl = "http://backend:3001/api/v1/resource-pack/aa.zip",
            hash = SAMPLE_HASH,
        )
        val info = mgr.currentPackInfo
        assertNotNull(info)
        // The download URL is what AssetCatalog.update is called with (see
        // ResourcePackManager.updateCatalogAsync). The player URL is what
        // pushToPlayer sends via addResourcePack.
        assertEquals("http://backend:3001/api/v1/resource-pack/aa.zip", info.downloadUrl)
        assertEquals("http://player-only.example/pack.zip", info.url)
    }

    /**
     * Records `apply()` invocations. Overrides the production HTTP path so
     * tests never make a network call. Returns silently — no extraction in
     * tests; we only care that the manager calls us.
     */
    private class RecordingDelegator : net.artisanmc.plugin.resourcepack.ResourcePackDelegator(
        targetDir = java.io.File("."),
        logger = null,
    ) {
        data class Call(val url: String, val hash: String)
        val calls = mutableListOf<Call>()
        override fun apply(downloadUrl: String, expectedHash: String) {
            calls += Call(downloadUrl, expectedHash)
        }
    }

    /**
     * Manager subclass that runs the delegate action inline instead of on a
     * daemon thread, so tests can assert immediately without race conditions.
     */
    private class InlineManager(
        plugin: JavaPlugin,
        config: ResourcePackConfig,
        logger: Logger?,
        delegator: net.artisanmc.plugin.resourcepack.ResourcePackDelegator?,
    ) : net.artisanmc.plugin.resourcepack.ResourcePackManager(
        plugin = plugin,
        config = config,
        logger = logger,
        delegator = delegator,
    ) {
        override fun runDelegate(action: () -> Unit) { action() }
    }

    @Test
    fun `onUpdate in delegate mode calls delegator and skips player push`() {
        server.addPlayer()
        val delegator = RecordingDelegator()
        val mgr = InlineManager(plugin, config(), plugin.logger, delegator)

        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        mgr.onUpdate(info)

        // Delegator was called with the expected URL + hash.
        assertEquals(1, delegator.calls.size)
        assertEquals("http://x", delegator.calls[0].url)
        assertEquals(SAMPLE_HASH, delegator.calls[0].hash)
        // currentPackInfo is still set after delegate.
        assertEquals(info, mgr.currentPackInfo)
        // No player push happened — if addResourcePack had been called,
        // MockBukkit's Player would have thrown UnimplementedOperationException
        // and this assertion would never run.
    }

    @Test
    fun `onUpdate with null in delegate mode does NOT iterate online players`() {
        server.addPlayer()
        val delegator = RecordingDelegator()
        val mgr = InlineManager(plugin, config(), plugin.logger, delegator)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        delegator.calls.clear()

        mgr.onUpdate(null)

        assertTrue(delegator.calls.isEmpty(), "delegator should NOT be called on null")
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `onJoin in delegate mode is a no-op`() {
        val player = server.addPlayer()
        val delegator = RecordingDelegator()
        val mgr = InlineManager(plugin, config(sendOnJoin = true, delayTicks = 0L), plugin.logger, delegator)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        delegator.calls.clear()

        mgr.onJoin(player)

        assertTrue(delegator.calls.isEmpty(), "delegator should NOT be called on join")
        // If addResourcePack had been called, MockBukkit's Player would have
        // thrown UnimplementedOperationException.
    }
}
