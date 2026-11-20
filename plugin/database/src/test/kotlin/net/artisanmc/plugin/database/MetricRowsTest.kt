package net.artisanmc.plugin.database

import net.artisanmc.plugin.stats.ExportedServerTime
import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.plugin.stats.ExportedValue
import net.artisanmc.plugin.stats.MetricValue
import net.artisanmc.plugin.stats.StatsExport
import java.nio.file.Files
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MetricRowsTest {
    private val dir = Files.createTempDirectory("artisan_metrics_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("MetricRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = MetricRows(ds)
    private val a = "00000000-0000-0000-0000-00000000000a"
    private val b = "00000000-0000-0000-0000-00000000000b"

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a value is inserted, replaced, and an unchanged value keeps its time`() {
        rows.write(listOf(MetricValue("daily:streak", a, 1)), now = 100)
        rows.write(listOf(MetricValue("daily:streak", a, 2)), now = 200)
        rows.write(listOf(MetricValue("daily:streak", a, 2)), now = 300)
        assertEquals(2, rows.get("daily:streak", a))
        assertEquals(listOf(ExportedValue("daily:streak", a, 2, 200)), rows.values(Long.MIN_VALUE, 1_000, null, 10))
    }

    @Test
    fun `values are read in time, metric, player order, a page after the previous one`() {
        rows.write(listOf(MetricValue("m:x", b, 1), MetricValue("m:x", a, 1), MetricValue("m:a", b, 1)), now = 100)
        rows.write(listOf(MetricValue("m:x", a, 2)), now = 50)
        val first = rows.values(0, 1_000, null, 2)
        assertEquals(listOf("m:x" to a, "m:a" to b), first.map { it.metric to it.player })
        val second = rows.values(0, 1_000, first.last(), 2)
        assertEquals(listOf("m:x" to b), second.map { it.metric to it.player })
        assertEquals(emptyList(), rows.values(100, 1_000, null, 10))
    }

    @Test
    fun `players are read by last seen with their play time`() {
        val players = PlayerRows(ds)
        players.seen(UUID.fromString(a), "Alice", now = 1_000, firstSeen = 10)
        players.seen(UUID.fromString(b), "Bob", now = 2_000)
        players.addPlaytime(UUID.fromString(a), 60_000, now = 3_000)
        val page = rows.players(1_500, 5_000, null, 10)
        assertEquals(listOf("Bob", "Alice"), page.map { it.name })
        assertEquals(60_000, page.last().playtimeMs)
        assertEquals(10, page.last().firstSeen)
    }

    @Test
    fun `forgetting a player deletes their values and leaves the mark the export sends`() {
        rows.write(listOf(MetricValue("daily:streak", a, 4), MetricValue("daily:streak", b, 1)), now = 100)
        assertEquals(1, rows.forget(a, now = 200))
        rows.forget(a, now = 300)
        assertNull(rows.get("daily:streak", a))
        assertEquals(1, rows.get("daily:streak", b))
        assertEquals(listOf(ExportedValue(StatsExport.FORGOTTEN, a, 0, 300)), rows.values(150, 1_000, null, 10))
    }

    @Test
    fun `play time per server is read in time, server, player order, with the names of its servers`() {
        val registry = ServerRegistry(ds, DatabaseDialect.H2, Logger.getAnonymousLogger())
        val (lobby, survie) = listOf("lobby", "survie").map { name ->
            UUID.randomUUID().also { registry.register(it, name, java.time.Instant.EPOCH) }.let { registry.rowId(it)!! }
        }
        UUID.randomUUID().also { registry.register(it, "empty", java.time.Instant.EPOCH) }
        val players = PlayerRows(ds)
        players.addPlaytime(UUID.fromString(b), 4_000, 100, survie)
        players.addPlaytime(UUID.fromString(a), 2_000, 100, survie)
        players.addPlaytime(UUID.fromString(a), 1_000, 100, lobby)
        players.addPlaytime(UUID.fromString(a), 9_000, 200, lobby)
        val first = rows.serverTimes(Long.MIN_VALUE, 1_000, null, 2)
        assertEquals(listOf(ExportedServerTime(survie.value, a, 2_000, 100), ExportedServerTime(survie.value, b, 4_000, 100)), first)
        assertEquals(listOf(ExportedServerTime(lobby.value, a, 10_000, 200)), rows.serverTimes(Long.MIN_VALUE, 1_000, first.last(), 2))
        assertEquals(listOf(ExportedServerTime(lobby.value, a, 10_000, 200)), rows.serverTimes(150, 1_000, null, 10))
        assertEquals(mapOf(lobby.value to "lobby", survie.value to "survie"), rows.servers())
    }
}
