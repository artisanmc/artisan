package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.resourcepack.AssetCatalog
import net.artisanmc.plugin.resourcepack.ResourcePackDelegator
import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import net.artisanmc.plugin.resourcepack.PackLoadTracker
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.entity.Player
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.plugin.java.JavaPlugin
import java.util.UUID
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
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

    private fun config(
        reloadCommand: String? = null,
        enabled: Boolean = true,
        prompt: String? = null,
        sendOnJoin: Boolean = true,
        delayTicks: Long = 0L,
    ) = ResourcePackConfig(
        delegateToDir = null,
        delegateReloadCommand = reloadCommand,
        enabled = enabled,
        prompt = prompt,
        sendOnJoin = sendOnJoin,
        sendDelayTicks = delayTicks,
    )

    private val SAMPLE_HASH = "0".repeat(40)
    private val OTHER_HASH = "a".repeat(40)

    /**
     * Records the pack stack calls instead of making them: MockBukkit does not implement
     * [Player.sendResourcePacks] nor [Player.removeResourcePacks].
     */
    private class RecordingManager(
        plugin: JavaPlugin,
        config: ResourcePackConfig,
        logger: Logger? = null,
        packLoads: PackLoadTracker? = null,
        delegator: ResourcePackDelegator? = null,
    ) : ResourcePackManager(
        plugin, config, logger, delegator = delegator, packLoads = packLoads,
        defaultPrompt = { Component.text("lang prompt of ${it.name}") },
    ) {
        sealed interface Call {
            data class Add(val player: String, val uuid: UUID, val url: String, val prompt: String) : Call
            data class Remove(val player: String, val uuid: UUID) : Call
        }

        val calls = mutableListOf<Call>()
        val adds get() = calls.filterIsInstance<Call.Add>()
        val removes get() = calls.filterIsInstance<Call.Remove>()

        override fun addPack(player: Player, info: ResourcePackInfo, prompt: Component) {
            calls += Call.Add(player.name, info.uuid, info.url, PlainTextComponentSerializer.plainText().serialize(prompt))
        }

        override fun removePack(player: Player, uuid: UUID) {
            calls += Call.Remove(player.name, uuid)
        }
    }

    @Test
    fun `manager starts with no current pack`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `onUpdate stores the info`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH)
        mgr.onUpdate(info)
        assertEquals(info, mgr.currentPackInfo)
    }

    @Test
    fun `onUpdate persists pack info and loadFromDisk restores it after a restart`(
        @org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path,
    ) {
        val cache = tmp.resolve("resource-pack.json").toFile()
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger, cacheFile = cache)
        mgr.onUpdate(ResourcePackInfo.from("http://player", "http://internal", SAMPLE_HASH))
        assertTrue(cache.exists())

        // Fresh manager (simulated restart, hub down) restores the info.
        val mgr2 = ResourcePackManager(plugin, config(), logger = plugin.logger, cacheFile = cache)
        mgr2.loadFromDisk()
        assertEquals("http://player", mgr2.currentPackInfo?.url)
        assertEquals("http://internal", mgr2.currentPackInfo?.downloadUrl)
        assertEquals(SAMPLE_HASH, mgr2.currentPackInfo?.hash)
    }

    @Test
    fun `onUpdate with null deletes the cache file and clears the state`(
        @org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path,
    ) {
        val cache = tmp.resolve("resource-pack.json").toFile()
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger, cacheFile = cache)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        mgr.onUpdate(null)
        assertFalse(cache.exists())
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `applyPack with dual URLs stores both on the info`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        mgr.applyPack(
            playerUrl = "http://localhost:3001/pack.zip",
            downloadUrl = "http://backend:3001/pack.zip",
            hash = SAMPLE_HASH,
        )
        val info = assertNotNull(mgr.currentPackInfo)
        assertEquals("http://localhost:3001/pack.zip", info.url)
        assertEquals("http://backend:3001/pack.zip", info.downloadUrl)
    }

    @Test
    fun `single-URL applyPack defaults downloadUrl to url`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        mgr.applyPack(url = "http://x/pack.zip", hash = SAMPLE_HASH)
        val info = assertNotNull(mgr.currentPackInfo)
        assertEquals("http://x/pack.zip", info.url)
        assertEquals("http://x/pack.zip", info.downloadUrl)
    }

    @Test
    fun `AssetCatalog receives the download URL, not the player URL`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger, assetCatalog = AssetCatalog())
        mgr.applyPack(
            playerUrl = "http://player-only.example/pack.zip",
            downloadUrl = "http://backend:3001/api/v1/resource-pack/aa.zip",
            hash = SAMPLE_HASH,
        )
        val info = assertNotNull(mgr.currentPackInfo)
        // ResourcePackManager.updateCatalogAsync reads info.downloadUrl.
        assertEquals("http://backend:3001/api/v1/resource-pack/aa.zip", info.downloadUrl)
    }

    private class RecordingHandler : Handler() {
        val records = mutableListOf<LogRecord>()
        override fun publish(record: LogRecord) { records += record }
        override fun flush() {}
        override fun close() {}
    }

    private fun recordingLogger(): Pair<Logger, RecordingHandler> {
        val handler = RecordingHandler()
        val logger = Logger.getAnonymousLogger().apply {
            useParentHandlers = false
            addHandler(handler)
        }
        return logger to handler
    }

    @Test
    fun `disabled and without a delegator an update reaches no player and warns once`() {
        server.addPlayer("alice")
        val (logger, handler) = recordingLogger()
        val mgr = RecordingManager(plugin, config(enabled = false), logger = logger)

        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        mgr.onJoin(server.addPlayer("bob"))

        assertTrue(mgr.calls.isEmpty())
        val warnings = handler.records.filter { it.level == Level.WARNING }.map { it.message }
        assertEquals(
            listOf(
                "[resource-pack] pack $SAMPLE_HASH not applied: resource-pack.enabled is false and " +
                    "resource-pack.delegate-to-dir is empty",
            ),
            warnings,
        )
    }

    @Test
    fun `without a delegator the pack is added to every online player`() {
        server.addPlayer("alice")
        server.addPlayer("bob")
        val mgr = RecordingManager(plugin, config())
        val info = ResourcePackInfo.from("http://pack.example/p.zip", SAMPLE_HASH)

        mgr.onUpdate(info)

        assertEquals(setOf("alice", "bob"), mgr.adds.map { it.player }.toSet())
        assertTrue(mgr.adds.all { it.uuid == info.uuid && it.url == "http://pack.example/p.zip" })
        assertTrue(mgr.removes.isEmpty(), "no previous Artisan pack to remove")
    }

    @Test
    fun `a new pack removes the previous one from each player, then adds itself`() {
        server.addPlayer("alice")
        val mgr = RecordingManager(plugin, config())
        val first = ResourcePackInfo.from("http://x", SAMPLE_HASH)
        mgr.onUpdate(first)
        mgr.calls.clear()

        val second = ResourcePackInfo.from("http://y", OTHER_HASH)
        mgr.onUpdate(second)

        assertEquals(
            listOf(
                RecordingManager.Call.Remove("alice", first.uuid),
                RecordingManager.Call.Add("alice", second.uuid, "http://y", "lang prompt of alice"),
            ),
            mgr.calls,
        )
    }

    @Test
    fun `the same pack announced again is not sent again`() {
        server.addPlayer("alice")
        val mgr = RecordingManager(plugin, config())
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        mgr.calls.clear()

        mgr.onUpdate(ResourcePackInfo.from("http://x-bis", SAMPLE_HASH))

        assertTrue(mgr.calls.isEmpty(), "got ${mgr.calls}")
    }

    @Test
    fun `after a reload a player who already loaded the pack is left alone`() {
        val packLoads = PackLoadTracker()
        val alice = server.addPlayer("alice")
        val bob = server.addPlayer("bob")
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH)
        RecordingManager(plugin, config(), packLoads = packLoads).onUpdate(info)
        packLoads.onStatus(PlayerResourcePackStatusEvent(alice, info.uuid, PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED))

        // `/artisan reload`: a new manager, the hub announces the same pack again.
        val reloaded = RecordingManager(plugin, config(), packLoads = packLoads)
        reloaded.onUpdate(info)

        assertEquals(listOf("bob"), reloaded.adds.map { it.player })
        assertTrue(packLoads.hasLoaded(alice.uniqueId))
        assertFalse(packLoads.hasLoaded(bob.uniqueId))
    }

    @Test
    fun `sent directly only Artisan's pack counts as loaded, delegated any pack does`() {
        val packLoads = PackLoadTracker()
        val alice = server.addPlayer("alice")
        RecordingManager(plugin, config(), packLoads = packLoads).onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        val otherPlugin = UUID.randomUUID()
        packLoads.onStatus(PlayerResourcePackStatusEvent(alice, otherPlugin, PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED))
        assertFalse(packLoads.hasLoaded(alice.uniqueId), "another plugin's pack does not carry Artisan's glyphs")

        RecordingManager(plugin, config(), packLoads = packLoads, delegator = RecordingDelegator())
        packLoads.onStatus(PlayerResourcePackStatusEvent(alice, otherPlugin, PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED))
        assertTrue(packLoads.hasLoaded(alice.uniqueId), "delegated, Artisan's pack is inside the host's")
    }

    @Test
    fun `clearing the pack removes it from every player`() {
        server.addPlayer("alice")
        server.addPlayer("bob")
        val mgr = RecordingManager(plugin, config())
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH)
        mgr.onUpdate(info)
        mgr.calls.clear()

        mgr.onUpdate(null)

        assertEquals(setOf("alice", "bob"), mgr.removes.map { it.player }.toSet())
        assertTrue(mgr.removes.all { it.uuid == info.uuid })
        assertTrue(mgr.adds.isEmpty())
        // The next pack has no previous one to remove.
        mgr.calls.clear()
        mgr.onUpdate(ResourcePackInfo.from("http://z", OTHER_HASH))
        assertEquals(2, mgr.adds.size)
        assertTrue(mgr.removes.isEmpty())
    }

    @Test
    fun `a joining player gets the current pack, unless send-on-join is false`() {
        val mgr = RecordingManager(plugin, config())
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        mgr.onJoin(server.addPlayer("alice"))
        assertEquals(listOf("alice"), mgr.adds.map { it.player })

        val quiet = RecordingManager(plugin, config(sendOnJoin = false))
        quiet.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        quiet.calls.clear()
        quiet.onJoin(server.addPlayer("bob"))
        assertTrue(quiet.calls.isEmpty())
    }

    @Test
    fun `the join send waits send-delay-ticks`() {
        val mgr = RecordingManager(plugin, config(delayTicks = 20L))
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        mgr.onJoin(server.addPlayer("alice"))
        assertTrue(mgr.adds.isEmpty())
        server.scheduler.performTicks(21L)
        assertEquals(listOf("alice"), mgr.adds.map { it.player })
    }

    @Test
    fun `without a pack a joining player gets nothing`() {
        val mgr = RecordingManager(plugin, config())
        mgr.onJoin(server.addPlayer("alice"))
        assertTrue(mgr.calls.isEmpty())
    }

    @Test
    fun `the prompt comes from the config, else from the player's language`() {
        server.addPlayer("alice")
        val configured = RecordingManager(plugin, config(prompt = "<gold>Our pack</gold>"))
        configured.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        assertEquals("Our pack", configured.adds.single().prompt)

        val fromLang = RecordingManager(plugin, config())
        fromLang.onUpdate(ResourcePackInfo.from("http://x", OTHER_HASH))
        assertEquals("lang prompt of alice", fromLang.adds.single().prompt)
    }

    @Test
    fun `a pack served on localhost warns that players cannot reach it`() {
        server.addPlayer("alice")
        val (logger, handler) = recordingLogger()
        RecordingManager(plugin, config(), logger = logger).onUpdate(ResourcePackInfo.from("http://localhost:8765/resource-pack/a.zip", SAMPLE_HASH))
        assertTrue(handler.records.any { it.level == Level.WARNING && "web.url" in it.message })
    }

    /** Records `apply()` invocations instead of downloading. */
    private class RecordingDelegator : ResourcePackDelegator(targetDir = java.io.File("."), logger = null) {
        data class Call(val url: String, val hash: String)
        val calls = mutableListOf<Call>()
        override fun apply(downloadUrl: String, expectedHash: String) {
            calls += Call(downloadUrl, expectedHash)
        }
    }

    /** Runs the delegate action inline and records host reloads, for race-free assertions. */
    private class InlineManager(
        plugin: JavaPlugin,
        config: ResourcePackConfig,
        logger: Logger?,
        delegator: ResourcePackDelegator?,
    ) : ResourcePackManager(plugin = plugin, config = config, logger = logger, delegator = delegator) {
        var reloads = 0
        override fun runDelegate(action: () -> Unit) { action() }
        override fun runMainThread(action: () -> Unit) { reloads++ }
    }

    @Test
    fun `onUpdate hands the pack to the delegator, then reloads the host`() {
        val delegator = RecordingDelegator()
        val (logger, handler) = recordingLogger()
        val mgr = InlineManager(plugin, config(reloadCommand = "n reload"), logger, delegator)

        val info = ResourcePackInfo.from("http://player", "http://internal", SAMPLE_HASH)
        mgr.onUpdate(info)

        assertEquals(listOf(RecordingDelegator.Call("http://internal", SAMPLE_HASH)), delegator.calls)
        assertEquals(1, mgr.reloads)
        assertEquals(info, mgr.currentPackInfo)
        assertTrue(handler.records.none { it.level == Level.WARNING })
    }

    @Test
    fun `a pack already applied is not handed to the delegator again, a new one is`() {
        val delegator = RecordingDelegator()
        val mgr = InlineManager(plugin, config(reloadCommand = "n reload"), null, delegator)
        val info = ResourcePackInfo.from("http://player", "http://internal", SAMPLE_HASH)
        mgr.onUpdate(info)
        // The hub announces the same pack again: a reconnection, `/artisan reload`.
        mgr.onUpdate(ResourcePackInfo.from("http://player2", "http://internal", SAMPLE_HASH))
        assertEquals(1, delegator.calls.size)
        assertEquals(1, mgr.reloads)
        assertEquals("http://player2", mgr.currentPackInfo?.url, "the addresses are still taken")
        val other = "b".repeat(40)
        mgr.onUpdate(ResourcePackInfo.from("http://player", "http://internal", other))
        assertEquals(listOf(SAMPLE_HASH, other), delegator.calls.map { it.hash })
        // Cleared, then announced again: applied again.
        mgr.onUpdate(null)
        mgr.onUpdate(ResourcePackInfo.from("http://player", "http://internal", other))
        assertEquals(3, delegator.calls.size)
    }

    @Test
    fun `delegated, nothing is sent to players, on update or on join`() {
        server.addPlayer("alice")
        val mgr = RecordingManager(plugin, config(), delegator = RecordingDelegator())
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        mgr.onJoin(server.addPlayer("bob"))
        mgr.onUpdate(null)
        assertTrue(mgr.calls.isEmpty(), "got ${mgr.calls}")
    }

    @Test
    fun `onUpdate with null does not call the delegator`() {
        val delegator = RecordingDelegator()
        val mgr = InlineManager(plugin, config(), plugin.logger, delegator)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))
        delegator.calls.clear()

        mgr.onUpdate(null)

        assertTrue(delegator.calls.isEmpty())
        assertNull(mgr.currentPackInfo)
    }
}
