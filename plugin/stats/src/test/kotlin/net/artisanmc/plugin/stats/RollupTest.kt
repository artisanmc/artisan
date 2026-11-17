package net.artisanmc.plugin.stats

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals

class RollupTest {
    private val paris = ZoneId.of("Europe/Paris")
    private fun at(text: String) = ZonedDateTime.parse(text).toEpochSecond()

    @Test
    fun `a day starts at local midnight`() {
        // 23:30 UTC on the 14th is 00:30 on the 15th in Paris.
        assertEquals(at("2026-11-15T00:00+01:00[Europe/Paris]"), Rollup.dayStart(at("2026-11-14T23:30Z"), paris))
        assertEquals(at("2026-11-14T00:00Z"), Rollup.dayStart(at("2026-11-14T23:30Z"), ZoneId.of("UTC")))
        assertEquals(at("2026-11-16T00:00+01:00[Europe/Paris]"), Rollup.nextDay(at("2026-11-15T00:00+01:00[Europe/Paris]"), paris))
    }

    @Test
    fun `hours merge into their local day per player, event and dimensions`() {
        val h1 = at("2026-11-14T22:00Z") // 23:00 Paris, the 14th
        val h2 = at("2026-11-14T23:00Z") // 00:00 Paris, the 15th
        val h3 = at("2026-11-15T10:00Z")
        val rows = listOf(
            BucketRow("p", "e", "", h1, Granularity.HOUR, 1, 5.0, 5.0, 5.0),
            BucketRow("p", "e", "", h2, Granularity.HOUR, 2, 4.0, 1.0, 3.0),
            BucketRow("p", "e", "", h3, Granularity.HOUR, 1, 9.0, 9.0, 9.0),
            BucketRow("q", "e", "", h3, Granularity.HOUR, 1, 1.0, 1.0, 1.0),
        )
        val day14 = at("2026-11-14T00:00+01:00[Europe/Paris]")
        val day15 = at("2026-11-15T00:00+01:00[Europe/Paris]")
        assertEquals(
            setOf(
                BucketRow("p", "e", "", day14, Granularity.DAY, 1, 5.0, 5.0, 5.0),
                BucketRow("p", "e", "", day15, Granularity.DAY, 3, 13.0, 1.0, 9.0),
                BucketRow("q", "e", "", day15, Granularity.DAY, 1, 1.0, 1.0, 1.0),
            ),
            Rollup.days(rows, paris).toSet(),
        )
    }
}
