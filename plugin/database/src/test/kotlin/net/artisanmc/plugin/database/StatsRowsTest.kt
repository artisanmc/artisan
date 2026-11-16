package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.plugin.stats.BreakdownQuery
import net.artisanmc.plugin.stats.BreakdownRow
import net.artisanmc.plugin.stats.BucketRow
import net.artisanmc.plugin.stats.CatalogEntry
import net.artisanmc.plugin.stats.EventsQuery
import net.artisanmc.plugin.stats.Granularity
import net.artisanmc.plugin.stats.RawRow
import net.artisanmc.plugin.stats.SeriesPoint
import net.artisanmc.plugin.stats.SeriesQuery
import net.artisanmc.plugin.stats.StatsBatch
import java.nio.file.Files
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class StatsRowsTest {
    private val dir = Files.createTempDirectory("artisan_stats_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("StatsRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = StatsRows(ds)
    private val lobby = rows.writer(1)
    private val survival = rows.writer(2)
    private val utc = ZoneId.of("UTC")

    @AfterTest fun teardown() = pools.closeAll()

    private fun at(text: String) = ZonedDateTime.parse(text).toEpochSecond()
    private fun hour(player: String, start: String, dims: String = "menu=shop", count: Long = 1, sum: Double = count.toDouble(), min: Double = 1.0, max: Double = 1.0, event: String = "core:menu_open") =
        BucketRow(player, event, dims, at(start), Granularity.HOUR, count, sum, min, max)
    private fun raw(player: String, at: Long, event: String = "core:session", value: Double = 1.0) = RawRow(player, event, at, "", value, """{"ip":"no"}""")
    private fun series(server: Int, by: Granularity = Granularity.HOUR, player: String? = null) =
        rows.series(server, SeriesQuery("core:menu_open", at("2026-01-01T00:00Z"), at("2027-01-01T00:00Z"), by, player = player, zone = utc))

    @Test
    fun `a bucket written twice adds up and keeps the extremes`() {
        lobby.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z", count = 2, sum = 6.0, min = 2.0, max = 4.0)), emptyList()))
        lobby.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z", count = 1, sum = 9.0, min = 9.0, max = 9.0)), emptyList()))
        assertEquals(listOf(SeriesPoint(at("2026-11-14T10:00Z"), Granularity.HOUR, 3, 15.0, 2.0, 9.0)), series(1))
    }

    @Test
    fun `each server reads its own rows, players filter, dimensions break down`() {
        lobby.write(StatsBatch(listOf(
            hour("a", "2026-11-14T10:00Z", "menu=shop", 2),
            hour("b", "2026-11-14T10:00Z", "menu=shop", 3),
            hour("b", "2026-11-14T10:00Z", "menu=warps", 1),
            hour("", "2026-11-14T10:00Z", "", 4, event = "core:players_online"),
        ), emptyList()))
        survival.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z", "menu=shop", 100)), emptyList()))
        assertEquals(6, series(1).single().count)
        assertEquals(2, series(1, player = "a").single().count)
        assertEquals(100, series(2).single().count)
        val q = BreakdownQuery("core:menu_open", at("2026-01-01T00:00Z"), at("2027-01-01T00:00Z"), "menu")
        assertEquals(listOf(BreakdownRow("shop", 5, 5.0, 1.0, 1.0), BreakdownRow("warps", 1, 1.0, 1.0, 1.0)), rows.breakdown(1, q))
        assertEquals(
            listOf(CatalogEntry("core:menu_open", true, false), CatalogEntry("core:players_online", true, false)),
            rows.catalog(1),
        )
    }

    @Test
    fun `hours before the cutoff merge into days once, later hours stay`() {
        lobby.write(StatsBatch(listOf(
            hour("a", "2026-11-10T08:00Z", count = 1, min = 1.0, max = 1.0),
            hour("a", "2026-11-10T20:00Z", count = 2, sum = 6.0, min = 3.0, max = 3.0),
            hour("a", "2026-11-11T09:00Z", count = 5),
            hour("a", "2026-11-12T09:00Z", count = 7),
        ), emptyList()))
        survival.write(StatsBatch(listOf(hour("a", "2026-11-10T08:00Z", count = 9)), emptyList()))
        assertEquals(2, lobby.rollup(at("2026-11-12T00:00Z"), utc))
        assertEquals(0, lobby.rollup(at("2026-11-12T00:00Z"), utc))
        assertEquals(
            listOf(
                SeriesPoint(at("2026-11-10T00:00Z"), Granularity.DAY, 3, 7.0, 1.0, 3.0),
                SeriesPoint(at("2026-11-11T00:00Z"), Granularity.DAY, 5, 5.0, 1.0, 1.0),
                SeriesPoint(at("2026-11-12T09:00Z"), Granularity.HOUR, 7, 7.0, 1.0, 1.0),
            ),
            series(1),
        )
        assertEquals(Granularity.HOUR, series(2).single().granularity)
        // Late hours of an already merged day merge into the same day row.
        lobby.write(StatsBatch(listOf(hour("a", "2026-11-11T22:00Z", count = 1)), emptyList()))
        assertEquals(1, lobby.rollup(at("2026-11-12T00:00Z"), utc))
        assertEquals(6, series(1).first { it.start == at("2026-11-11T00:00Z") }.count)
        assertEquals(1, lobby.purgeDays(at("2026-11-11T00:00Z")))
        assertEquals(listOf(at("2026-11-11T00:00Z"), at("2026-11-12T09:00Z")), series(1).map { it.start })
    }

    @Test
    fun `raw rows page newest first, filter, and purge by age with per-event cutoffs`() {
        lobby.write(StatsBatch(emptyList(), (1..5).map { raw("a", it * 1000L) } + raw("b", 6000) + raw("a", 7000, "core:first_join")))
        survival.write(StatsBatch(emptyList(), listOf(raw("a", 1000))))
        val first = rows.events(1, EventsQuery(event = "core:session", limit = 3))
        assertEquals(listOf(6000L, 5000L, 4000L), first.rows.map { it.at })
        assertEquals("""{"ip":"no"}""", first.rows.first().details)
        val second = rows.events(1, EventsQuery(event = "core:session", limit = 3, before = first.next))
        assertEquals(listOf(3000L, 2000L, 1000L), second.rows.map { it.at })
        assertNull(second.next)
        assertEquals(listOf(5000L, 4000L), rows.events(1, EventsQuery(player = "a", event = "core:session", from = 4000, to = 6000)).rows.map { it.at })
        assertEquals(4, lobby.purgeRaw(4000, mapOf("core:first_join" to 8000)))
        assertEquals(listOf(6000L, 5000L, 4000L), rows.events(1, EventsQuery()).rows.map { it.at })
        assertEquals(1, rows.events(2, EventsQuery()).rows.size)
        assertEquals(listOf(CatalogEntry("core:session", false, true)), rows.catalog(1))
    }

    @Test
    fun `forgetting a player deletes their rows on every server`() {
        lobby.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z"), hour("b", "2026-11-14T10:00Z")), listOf(raw("a", 1000), raw("b", 1000))))
        survival.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z")), listOf(raw("a", 1000))))
        assertEquals(4, rows.forget("a"))
        assertEquals(1, series(1).single().count)
        assertEquals(emptyList(), series(2))
        assertEquals(listOf("b"), rows.events(1, EventsQuery()).rows.map { it.player })
    }

    @Test
    fun `long dimensions are kept whole`() {
        val dims = (1..6).joinToString("&") { "d$it=" + "x".repeat(64) }
        lobby.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z", dims)), emptyList()))
        lobby.write(StatsBatch(listOf(hour("a", "2026-11-14T10:00Z", dims)), emptyList()))
        val q = BreakdownQuery("core:menu_open", at("2026-01-01T00:00Z"), at("2027-01-01T00:00Z"), "d6")
        assertEquals(2, rows.breakdown(1, q).single().count)
    }

    @Test
    fun `actives are the distinct players of an event, per point and over the period`() {
        lobby.write(StatsBatch(listOf(
            hour("a", "2026-11-14T10:00Z"), hour("a", "2026-11-14T11:00Z"), hour("b", "2026-11-14T11:00Z", "menu=warps"),
            hour("c", "2026-11-15T09:00Z"), hour("", "2026-11-15T09:00Z", "", event = "core:players_online"),
        ), emptyList()))
        survival.write(StatsBatch(listOf(hour("z", "2026-11-14T10:00Z")), emptyList()))
        val q = SeriesQuery("core:menu_open", at("2026-11-01T00:00Z"), at("2026-12-01T00:00Z"), Granularity.DAY, zone = utc)
        val actives = rows.actives(1, q)
        assertEquals(3, actives.players)
        assertEquals(listOf(at("2026-11-14T00:00Z") to 2, at("2026-11-15T00:00Z") to 1), actives.points.map { it.start to it.players })
        assertEquals(2, rows.actives(1, q.copy(dims = mapOf("menu" to "shop"))).players)
        assertEquals(1, rows.actives(1, q.copy(player = "a")).players)
    }
}
