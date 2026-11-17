package net.artisanmc.plugin.stats

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** A step of a journey: the first [event] whose dimensions include [dims], after the step before. */
data class JourneyGoal(val name: String, val event: String, val dims: Map<String, String> = emptyMap())

/**
 * A journey asked for the players who arrived in `[from, to)` (epoch seconds): its [goals] in
 * order, each to be reached within [windowDays] of the arrival. [now] bounds what can be known.
 */
data class JourneyQuery(
    val from: Long,
    val to: Long,
    val windowDays: Int,
    val goals: List<JourneyGoal>,
    val zone: ZoneId,
    val now: Long,
)

/** A raw row as a journey reads it; [at] in epoch milliseconds. */
data class RawHit(val player: String, val event: String, val at: Long, val dims: Map<String, String>, val details: String)

/** How many arrivals reached a goal, and the median time from the arrival to it. */
data class JourneyStep(val name: String, val players: Int, val medianSeconds: Double?)

/** Of the [eligible] arrivals old enough to tell, how many [returned] on day [day] after arriving. */
data class RetentionPoint(val day: Int, val eligible: Int, val returned: Int)

/** The arrivals of one week (starting [weekStart], epoch seconds): how many reached each goal, how many came back. */
data class JourneyCohort(val weekStart: Long, val arrivals: Int, val reached: List<Int>, val retention: List<RetentionPoint>)

/** What a player who did not come back did last: an event and its dimensions. */
data class LastAction(val event: String, val dims: Map<String, String>, val players: Int)

data class JourneyResult(
    val arrivals: Int,
    val steps: List<JourneyStep>,
    val retention: List<RetentionPoint>,
    val cohorts: List<JourneyCohort>,
    /** Arrivals not seen for [Journeys.AWAY_DAYS] days. */
    val leavers: Int,
    val lastActions: List<LastAction>,
)

/**
 * The player journeys (ADR `stats-foundation` ⑫), folded from raw rows in one pass in time order.
 *
 * - **Arrivals**: the players whose `core:first_join` falls in the period.
 * - **Funnel**: an arrival reaches goal n with the first matching row at or after the one that
 *   reached goal n-1, no later than `windowDays` after arriving.
 * - **Retention**: an arrival came back on day N when a session overlaps
 *   `[arrival + N days, arrival + N+1 days)`; only arrivals older than N+1 days count.
 * - **Cohorts**: the same, per week of arrival (weeks start on Monday, in the statistics' zone).
 * - **Last actions**: for the arrivals not seen for [AWAY_DAYS] days, the last row that is not a
 *   session: what they were doing before leaving. A hint, never a cause.
 */
object Journeys {
    const val FIRST_JOIN = "core:first_join"
    const val SESSION = "core:session"
    const val AWAY_DAYS = 7
    const val MAX_LAST_ACTIONS = 10
    val RETENTION_DAYS = listOf(1, 7, 30)
    private const val DAY_MS = 86_400_000L

    /** The rows [compute] needs, in time order: `[fromMs, toMs)`, of [events] or of every event when null. */
    fun interface Scan {
        fun rows(fromMs: Long, toMs: Long, events: Set<String>?, each: (RawHit) -> Unit)
    }

    private class Arrival(val at: Long, val week: Long) {
        var next = 0
        var reachedAt = LongArray(0)
        var lastSeen = at
        var lastAction: Pair<String, Map<String, String>>? = null
        val returned = BooleanArray(RETENTION_DAYS.size)
    }

    fun compute(scan: Scan, q: JourneyQuery): JourneyResult {
        val fromMs = q.from * 1000
        val toMs = q.to * 1000
        val nowMs = q.now * 1000
        val windowMs = q.windowDays * DAY_MS
        val arrivals = HashMap<String, Arrival>()
        scan.rows(fromMs, toMs, setOf(FIRST_JOIN)) { hit ->
            arrivals.getOrPut(hit.player) { Arrival(hit.at, weekStart(hit.at, q.zone)) }
        }
        if (arrivals.isNotEmpty()) {
            for (a in arrivals.values) a.reachedAt = LongArray(q.goals.size) { -1 }
            scan.rows(fromMs, nowMs + 1, null) { hit ->
                val a = arrivals[hit.player] ?: return@rows
                if (hit.at < a.at) return@rows
                if (a.next < q.goals.size && hit.at <= a.at + windowMs) {
                    val goal = q.goals[a.next]
                    if (hit.event == goal.event && goal.dims.all { (k, v) -> hit.dims[k] == v }) {
                        a.reachedAt[a.next] = hit.at
                        a.next++
                    }
                }
                if (hit.at > a.lastSeen) a.lastSeen = hit.at
                if (hit.event == SESSION) {
                    val start = startedAt(hit.details) ?: hit.at
                    RETENTION_DAYS.forEachIndexed { i, day ->
                        val open = a.at + day * DAY_MS
                        if (start < open + DAY_MS && hit.at >= open) a.returned[i] = true
                    }
                } else if (hit.event != FIRST_JOIN) {
                    a.lastAction = hit.event to hit.dims
                }
            }
        }

        val all = arrivals.values
        val steps = q.goals.mapIndexed { i, goal ->
            val times = all.filter { it.reachedAt[i] >= 0 }.map { (it.reachedAt[i] - it.at) / 1000 }
            JourneyStep(goal.name, times.size, median(times))
        }
        val cohorts = all.groupBy { it.week }.toSortedMap().map { (week, members) ->
            JourneyCohort(week, members.size, q.goals.indices.map { i -> members.count { it.reachedAt[i] >= 0 } }, retention(members, nowMs))
        }
        val gone = all.filter { it.lastSeen < nowMs - AWAY_DAYS * DAY_MS }
        val last = gone.mapNotNull { it.lastAction }.groupingBy { it }.eachCount()
            .entries.sortedWith(compareByDescending<Map.Entry<Pair<String, Map<String, String>>, Int>> { it.value }.thenBy { it.key.first })
            .take(MAX_LAST_ACTIONS)
            .map { LastAction(it.key.first, it.key.second, it.value) }
        return JourneyResult(all.size, steps, retention(all, nowMs), cohorts, gone.size, last)
    }

    private fun retention(members: Collection<Arrival>, nowMs: Long): List<RetentionPoint> =
        RETENTION_DAYS.mapIndexed { i, day ->
            val eligible = members.filter { it.at + (day + 1) * DAY_MS <= nowMs }
            RetentionPoint(day, eligible.size, eligible.count { it.returned[i] })
        }

    fun median(values: List<Long>): Double? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[mid].toDouble() else (sorted[mid - 1] + sorted[mid]) / 2.0
    }

    /** The Monday 00:00 of [atMs]'s week in [zone], in epoch seconds. */
    fun weekStart(atMs: Long, zone: ZoneId): Long =
        Instant.ofEpochMilli(atMs).atZone(zone).toLocalDate()
            .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(zone).toEpochSecond()

    private val STARTED_AT = Regex("\"started_at\"\\s*:\\s*\"?(\\d+)")

    /** A session row's `started_at` detail (epoch milliseconds), when it carries one. */
    fun startedAt(details: String): Long? = STARTED_AT.find(details)?.groupValues?.get(1)?.toLongOrNull()
}
