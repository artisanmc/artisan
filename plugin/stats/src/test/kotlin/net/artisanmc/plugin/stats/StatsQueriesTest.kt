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
}
