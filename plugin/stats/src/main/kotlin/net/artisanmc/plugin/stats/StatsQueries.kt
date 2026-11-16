package net.artisanmc.plugin.stats

import java.time.ZoneId

/** A series of [event] over `[from, to)` (epoch seconds), by [by], for one [player] or all, on buckets whose dimensions include [dims]. */
data class SeriesQuery(
    val event: String,
    val from: Long,
    val to: Long,
    val by: Granularity,
    val player: String? = null,
    val dims: Map<String, String> = emptyMap(),
    val zone: ZoneId = ZoneId.systemDefault(),
)

/** One point of a series: hours already merged into days stay day points in a series by hour. */
data class SeriesPoint(val start: Long, val granularity: Granularity, val count: Long, val sum: Double, val min: Double, val max: Double)

/** The distinct players of a point of a series. */
data class ActivesPoint(val start: Long, val players: Int)

/** The distinct players of an event over a period ([players]), and per point. */
data class Actives(val players: Int, val points: List<ActivesPoint>)

/** The totals of each value of [dimension] for [event] over `[from, to)`. */
data class BreakdownQuery(
    val event: String,
    val from: Long,
    val to: Long,
    val dimension: String,
    val player: String? = null,
    val dims: Map<String, String> = emptyMap(),
)

data class BreakdownRow(val value: String, val count: Long, val sum: Double, val min: Double, val max: Double)

/** Raw rows, newest first, before the row id [before] (the previous page's cursor). */
data class EventsQuery(
    val event: String? = null,
    /** Epoch milliseconds, inclusive. */
    val from: Long? = null,
    /** Epoch milliseconds, exclusive. */
    val to: Long? = null,
    val player: String? = null,
    val before: Long? = null,
    val limit: Int = 50,
)

data class EventRow(val id: Long, val player: String, val event: String, val at: Long, val dims: Map<String, String>, val value: Double, val details: String)

/** A page of raw rows; [next] is the cursor of the next page, null on the last. */
data class EventsPage(val rows: List<EventRow>, val next: Long?)

/** An event the database holds rows of, for one server: in buckets, in raw rows, or both. */
data class CatalogEntry(val event: String, val bucketed: Boolean, val raw: Boolean)

/**
 * The folds of a read (ADR `stats-foundation` ⑧): the database groups by bucket and dimensions,
 * then these filter on dimensions and merge, the same on every dialect.
 */
object StatsQueries {
    fun series(rows: List<BucketRow>, q: SeriesQuery): List<SeriesPoint> {
        val points = sortedMapOf<Pair<Long, Granularity>, SeriesPoint>(compareBy({ it.first }, { it.second }))
        for (row in rows) {
            if (row.event != q.event || !matches(row.dims, q.dims)) continue
            val start = if (q.by == Granularity.DAY && row.granularity == Granularity.HOUR) Rollup.dayStart(row.start, q.zone) else row.start
            val granularity = if (q.by == Granularity.DAY) Granularity.DAY else row.granularity
            val point = SeriesPoint(start, granularity, row.count, row.sum, row.min, row.max)
            points.merge(start to granularity, point) { a, b -> SeriesPoint(a.start, a.granularity, a.count + b.count, a.sum + b.sum, minOf(a.min, b.min), maxOf(a.max, b.max)) }
        }
        return points.values.toList()
    }

    /** The distinct players of [rows] (one per player, bucket and dimensions): server rows (`""`) are nobody. */
    fun actives(rows: List<BucketRow>, q: SeriesQuery): Actives {
        val all = HashSet<String>()
        val points = sortedMapOf<Long, MutableSet<String>>()
        for (row in rows) {
            if (row.player.isEmpty() || row.event != q.event || !matches(row.dims, q.dims)) continue
            val start = if (q.by == Granularity.DAY && row.granularity == Granularity.HOUR) Rollup.dayStart(row.start, q.zone) else row.start
            all += row.player
            points.getOrPut(start) { HashSet() } += row.player
        }
        return Actives(all.size, points.map { (start, players) -> ActivesPoint(start, players.size) })
    }

    fun breakdown(rows: List<BucketRow>, q: BreakdownQuery): List<BreakdownRow> {
        val totals = LinkedHashMap<String, BreakdownRow>()
        for (row in rows) {
            if (row.event != q.event || !matches(row.dims, q.dims)) continue
            val value = Dimensions.decode(row.dims)[q.dimension] ?: continue
            totals.merge(value, BreakdownRow(value, row.count, row.sum, row.min, row.max)) { a, b ->
                BreakdownRow(a.value, a.count + b.count, a.sum + b.sum, minOf(a.min, b.min), maxOf(a.max, b.max))
            }
        }
        return totals.values.sortedWith(compareByDescending<BreakdownRow> { it.count }.thenBy { it.value })
    }

    private fun matches(dims: String, filter: Map<String, String>): Boolean {
        if (filter.isEmpty()) return true
        val decoded = Dimensions.decode(dims)
        return filter.all { (k, v) -> decoded[k] == v }
    }
}

/** What the database does with statistics, for this server (ADR `stats-foundation` ⑤⑥⑨). */
interface StatsWriter {
    /** Writes [batch] in one transaction: buckets added to their rows, raw rows inserted. */
    fun write(batch: StatsBatch)

    /** Merges the hours that start before [before] (epoch seconds, a local midnight) into days; the number of days written. */
    fun rollup(before: Long, zone: ZoneId): Int

    /** Deletes the day buckets that start before [before] (epoch seconds). */
    fun purgeDays(before: Long): Int

    /** Deletes the raw rows older than [before] (epoch ms), or than their event's own cutoff in [perEvent]. */
    fun purgeRaw(before: Long, perEvent: Map<String, Long>): Int
}

/** What the editor reads, for a server named by its row in `artisan_servers`. */
interface StatsReader {
    fun catalog(server: Int): List<CatalogEntry>
    fun series(server: Int, q: SeriesQuery): List<SeriesPoint>
    fun breakdown(server: Int, q: BreakdownQuery): List<BreakdownRow>
    fun actives(server: Int, q: SeriesQuery): Actives
    fun events(server: Int, q: EventsQuery): EventsPage
}
