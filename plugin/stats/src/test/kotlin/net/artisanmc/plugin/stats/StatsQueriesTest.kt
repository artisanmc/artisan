package net.artisanmc.plugin.stats

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals

class StatsQueriesTest {
    private val utc = ZoneId.of("UTC")
    private fun at(text: String) = ZonedDateTime.parse(text).toEpochSecond()
    private fun row(start: String, g: Granularity, dims: String, count: Long, sum: Double = count.toDouble(), min: Double = 1.0, max: Double = 1.0) =
        BucketRow("", "core:menu_click", dims, at(start), g, count, sum, min, max)

    private val rows = listOf(
        row("2026-11-14T10:00Z", Granularity.HOUR, "element=buy&menu=shop", 3),
        row("2026-11-14T10:00Z", Granularity.HOUR, "element=sell&menu=shop", 1),
        row("2026-11-14T11:00Z", Granularity.HOUR, "element=buy&menu=shop", 2),
        row("2026-11-14T11:00Z", Granularity.HOUR, "element=go&menu=warps", 5),
        row("2026-11-10T00:00Z", Granularity.DAY, "element=buy&menu=shop", 7, min = 0.5, max = 4.0),
    )

    @Test
    fun `a series by hour sums the dimensions of each hour, days stay days`() {
        val q = SeriesQuery("core:menu_click", at("2026-11-01T00:00Z"), at("2026-11-15T00:00Z"), Granularity.HOUR, zone = utc)
        assertEquals(
            listOf(
                SeriesPoint(at("2026-11-10T00:00Z"), Granularity.DAY, 7, 7.0, 0.5, 4.0),
                SeriesPoint(at("2026-11-14T10:00Z"), Granularity.HOUR, 4, 4.0, 1.0, 1.0),
                SeriesPoint(at("2026-11-14T11:00Z"), Granularity.HOUR, 7, 7.0, 1.0, 1.0),
            ),
            StatsQueries.series(rows, q),
        )
    }

    @Test
    fun `a series by day folds hours into days and filters on dimensions`() {
        val q = SeriesQuery("core:menu_click", at("2026-11-01T00:00Z"), at("2026-11-15T00:00Z"), Granularity.DAY, dims = mapOf("menu" to "shop"), zone = utc)
        assertEquals(
            listOf(
                SeriesPoint(at("2026-11-10T00:00Z"), Granularity.DAY, 7, 7.0, 0.5, 4.0),
                SeriesPoint(at("2026-11-14T00:00Z"), Granularity.DAY, 6, 6.0, 1.0, 1.0),
            ),
            StatsQueries.series(rows, q),
        )
    }

    @Test
    fun `a breakdown totals each value of one dimension, largest first`() {
        val q = BreakdownQuery("core:menu_click", at("2026-11-01T00:00Z"), at("2026-11-15T00:00Z"), "element", dims = mapOf("menu" to "shop"))
        assertEquals(
            listOf(BreakdownRow("buy", 12, 12.0, 0.5, 4.0), BreakdownRow("sell", 1, 1.0, 1.0, 1.0)),
            StatsQueries.breakdown(rows, q),
        )
    }

    @Test
    fun `actives count each player once per point and once in the total`() {
        val day = 86_400L
        fun row(player: String, start: Long, dims: String = "menu=shop") = BucketRow(player, "core:menu_open", dims, start, Granularity.HOUR, 3, 3.0, 1.0, 1.0)
        val rows = listOf(row("a", 0), row("a", 3600), row("b", 3600), row("a", day), row("c", day, "menu=warps"), row("", day))
        val q = SeriesQuery("core:menu_open", 0, 2 * day, Granularity.DAY, zone = java.time.ZoneId.of("UTC"))
        assertEquals(Actives(3, listOf(ActivesPoint(0, 2), ActivesPoint(day, 2))), StatsQueries.actives(rows, q))
        assertEquals(Actives(2, listOf(ActivesPoint(0, 1), ActivesPoint(3600, 2), ActivesPoint(day, 1))), StatsQueries.actives(rows, q.copy(by = Granularity.HOUR, dims = mapOf("menu" to "shop"))))
    }

    @Test
    fun `a filled series has a point per bucket of the period, at zero where nothing was recorded`() {
        val utc = java.time.ZoneId.of("UTC")
        val rows = listOf(BucketRow("", "core:menu_open", "", 7200, Granularity.HOUR, 2, 2.0, 1.0, 1.0))
        val hours = StatsQueries.series(rows, SeriesQuery("core:menu_open", 100, 4 * 3600, Granularity.HOUR, zone = utc, fill = true))
        assertEquals(listOf(0L to 0L, 3600L to 0L, 7200L to 2L, 10800L to 0L), hours.map { it.start to it.count })
        val days = StatsQueries.series(rows, SeriesQuery("core:menu_open", 0, 3 * 86_400, Granularity.DAY, zone = utc, fill = true))
        assertEquals(listOf(0L to 2L, 86_400L to 0L, 172_800L to 0L), days.map { it.start to it.count })
        val players = StatsQueries.actives(emptyList(), SeriesQuery("core:menu_open", 0, 2 * 86_400, Granularity.DAY, zone = utc, fill = true))
        assertEquals(Actives(0, listOf(ActivesPoint(0, 0), ActivesPoint(86_400, 0))), players)
        // Too long a period by hour is left as it is.
        assertEquals(1, StatsQueries.series(rows, SeriesQuery("core:menu_open", 0, 3600L * 5000, Granularity.HOUR, zone = utc, fill = true)).size)
    }
}
