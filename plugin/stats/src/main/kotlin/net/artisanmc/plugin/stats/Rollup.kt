package net.artisanmc.plugin.stats

import java.time.Instant
import java.time.ZoneId

/** Hours merged into days (ADR `stats-foundation` ⑥), a day cut at local midnight. */
object Rollup {
    /** Epoch second of the local midnight that starts the day of [epochSecond]. */
    fun dayStart(epochSecond: Long, zone: ZoneId): Long =
        Instant.ofEpochSecond(epochSecond).atZone(zone).toLocalDate().atStartOfDay(zone).toEpochSecond()

    /** Epoch second of the midnight after the day starting at [dayStart]. */
    fun nextDay(dayStart: Long, zone: ZoneId): Long =
        Instant.ofEpochSecond(dayStart).atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toEpochSecond()

    /** The day rows of [hours]: one per player, event, dimensions and local day. */
    fun days(hours: List<BucketRow>, zone: ZoneId): List<BucketRow> {
        val days = LinkedHashMap<Triple<String, String, Pair<String, Long>>, BucketRow>()
        for (h in hours) {
            val day = h.copy(start = dayStart(h.start, zone), granularity = Granularity.DAY)
            days.merge(Triple(day.player, day.event, day.dims to day.start), day, BucketRow::plus)
        }
        return days.values.toList()
    }
}
