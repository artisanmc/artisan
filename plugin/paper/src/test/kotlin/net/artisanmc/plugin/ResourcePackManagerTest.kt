package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.resourcepack.AssetCatalog
import net.artisanmc.plugin.resourcepack.ResourcePackDelegator
import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import org.bukkit.plugin.java.JavaPlugin
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

    private fun config(reloadCommand: String? = null) =
        ResourcePackConfig(delegateToDir = null, delegateReloadCommand = reloadCommand)

    private val SAMPLE_HASH = "0".repeat(40)

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
    fun `without a delegator an update reaches no player and warns once`() {
        server.addPlayer("alice")
        val (logger, handler) = recordingLogger()
        val mgr = ResourcePackManager(plugin, config(), logger = logger)

        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH))

        val warnings = handler.records.filter { it.level == Level.WARNING }.map { it.message }
        assertEquals(
            listOf(
                "[resource-pack] pack $SAMPLE_HASH not applied: set resource-pack.delegate-to-dir " +
                    "to the pack folder of Nexo, Oraxen or ItemsAdder",
            ),
            warnings,
        )
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
