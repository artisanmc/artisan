package net.artisanmc.plugin.hub

import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.plugin.stats.BreakdownQuery
import net.artisanmc.plugin.stats.EventsQuery
import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.stats.Granularity
import net.artisanmc.plugin.stats.JourneyGoal
import net.artisanmc.plugin.stats.JourneyQuery
import net.artisanmc.plugin.stats.JourneyResult
import net.artisanmc.plugin.stats.Journeys
import net.artisanmc.plugin.stats.RetentionPoint
import net.artisanmc.plugin.stats.SeriesQuery
import net.artisanmc.plugin.stats.CatalogEntry
import net.artisanmc.plugin.stats.StatsReader
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** The journeys an admin saved for a server (`artisan_settings`), as the JSON list the routes validated. */
interface StatsJourneyStore {
    fun read(server: Int): String?
    fun write(server: Int, json: String)
}

/** The players the statistics can be filtered by: `artisan_players`, by the start of a name or by id. */
interface StatsPlayers {
    fun search(prefix: String, limit: Int): List<Pair<UUID, String>>
    fun names(ids: Collection<UUID>): List<Pair<UUID, String>>
}

/**
 * What the hub reads statistics through: the store ([reader], null while the suite database is
 * not open), the `artisan_servers` row of a server id, and what this server knows of the events
 * (the declarations of its own modules; a remote server's are not announced yet).
 */
class StatsAccess(
    val reader: () -> StatsReader?,
    val rowOf: (serverId: String) -> Int?,
    val enabled: () -> Boolean = { true },
    val declared: (serverId: String) -> List<StatEvent> = { emptyList() },
    /** Where a series by day cuts its days (`stats.timezone`). */
    val zone: () -> ZoneId = { ZoneId.systemDefault() },
    /** Null while the suite database is not open. */
    val players: () -> StatsPlayers? = { null },
    /** Null while the suite database is not open. */
    val journeys: () -> StatsJourneyStore? = { null },
    /** Epoch seconds: what a journey can know of. */
    val now: () -> Long = { System.currentTimeMillis() / 1000 },
)

/**
 * `/api/v1/servers/:server/stats/…` (ADR `stats-foundation` ⑧ and ⑫), behind `artisan.editor.stats`.
 * Read from the suite database, so an offline server's statistics stay readable. Periods are
 * `from` (inclusive) and `to` (exclusive), each an epoch second or an ISO-8601 instant.
 */
class StatsRoutes(private val servers: Servers, private val stats: StatsAccess, private val relay: Relay = Relay(null)) {
    fun register(router: Router) {
        // A figure a module computes on demand: asked to the running server, which caches it.
        router.on("GET", "${ServerRoutes.SERVER}/stats/query", EditorPermissions.STATS) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            if (!stats.enabled()) return@on call.error(404, "stats_disabled")
            val id = call.query("id")?.takeIf { StatEvent.NAME.matcher(it).matches() } ?: return@on call.error(422, "invalid_input")
            relay.send(call, server, mapOf("type" to "stats_query_fetch", "id" to id, "params" to call.queryPrefixed("p."))) { reply ->
                if (Relay.ok(reply)) call.json(mapOf("rows" to reply["rows"], "computed_at" to reply["computed_at"]))
                else when (Relay.errorCode(reply)) {
                    "unknown_query" -> call.error(404, "unknown_query")
                    "stats_disabled" -> call.error(404, "stats_disabled")
                    else -> call.error(502, "query_failed")
                }
            }
        }
        on(router, "catalog") { call, reader, row, server ->
            val declared = stats.declared(server.id).associateBy { it.name }
            // A declared event nothing recorded yet is listed too, as its declaration stores it: a
            // journey is composed before its goals ever happened.
            val stored = reader.catalog(row)
            val unseen = (declared.keys - stored.map { it.event }.toSet())
                .map { CatalogEntry(it, declared.getValue(it).storage.bucketed(), declared.getValue(it).storage.raw()) }
            call.json(mapOf("events" to (stored + unseen).sortedBy { it.event }.map { entry ->
                val shape = declared[entry.event]
                buildMap<String, Any?> {
                    put("event", entry.event)
                    put("bucketed", entry.bucketed)
                    put("raw", entry.raw)
                    if (shape != null) {
                        put("kind", shape.kind.name.lowercase())
                        put("scope", shape.scope.name.lowercase())
                        put("dimensions", shape.dimensions)
                        shape.valueName?.let { put("value", it) }
                    }
                }
            }))
        }
        on(router, "series") { call, reader, row, _ ->
            val period = period(call) ?: return@on call.error(422, "invalid_input")
            val by = granularity(call) ?: return@on call.error(422, "invalid_input")
            val q = SeriesQuery(period.event, period.from, period.to, by, period.player, call.queryPrefixed("dim."), stats.zone(), call.query("fill") == "1")
            call.json(mapOf("points" to reader.series(row, q).map {
                mapOf("start" to it.start, "granularity" to it.granularity.name.lowercase(), "count" to it.count, "sum" to it.sum, "min" to it.min, "max" to it.max)
            }))
        }
        on(router, "actives") { call, reader, row, _ ->
            val period = period(call) ?: return@on call.error(422, "invalid_input")
            val by = granularity(call) ?: return@on call.error(422, "invalid_input")
            val actives = reader.actives(row, SeriesQuery(period.event, period.from, period.to, by, period.player, call.queryPrefixed("dim."), stats.zone(), call.query("fill") == "1"))
            call.json(mapOf("players" to actives.players, "points" to actives.points.map { mapOf("start" to it.start, "players" to it.players) }))
        }
        on(router, "players") { call, _, _, _ ->
            val players = stats.players() ?: return@on call.error(503, "stats_unavailable")
            val ids = call.query("ids")?.split(',')?.filter { it.isNotBlank() }
            val found = if (ids != null) {
                if (ids.size > MAX_PAGE) return@on call.error(422, "invalid_input")
                players.names(ids.map { runCatching { UUID.fromString(it.trim()) }.getOrNull() ?: return@on call.error(422, "invalid_input") })
            } else {
                val q = call.query("q")?.trim().orEmpty()
                if (q.length > 16) return@on call.error(422, "invalid_input")
                players.search(q, 20)
            }
            call.json(mapOf("players" to found.map { (id, name) -> mapOf("id" to id.toString(), "name" to name) }))
        }
        on(router, "breakdown") { call, reader, row, _ ->
            val period = period(call) ?: return@on call.error(422, "invalid_input")
            val dimension = call.query("dim")?.takeIf { StatEvent.FIELD.matcher(it).matches() } ?: return@on call.error(422, "invalid_input")
            val q = BreakdownQuery(period.event, period.from, period.to, dimension, period.player, call.queryPrefixed("dim."))
            call.json(mapOf("rows" to reader.breakdown(row, q).map {
                mapOf("value" to it.value, "count" to it.count, "sum" to it.sum, "min" to it.min, "max" to it.max)
            }))
        }
        // The saved journeys of a server: ordered goals an admin composed (ADR `stats-foundation` ⑫).
        on(router, "journeys") { call, _, row, _ ->
            val store = stats.journeys() ?: return@on call.error(503, "stats_unavailable")
            val saved = store.read(row)?.let { runCatching { Call.mapper.readTree(it) }.getOrNull() }
            call.json(mapOf("journeys" to (saved ?: Call.mapper.createArrayNode())))
        }
        on(router, "journeys", "PUT") { call, _, row, _ ->
            val store = stats.journeys() ?: return@on call.error(503, "stats_unavailable")
            val list = call.body()?.path("journeys")?.takeIf { it.isArray && it.size() <= MAX_JOURNEYS } ?: return@on call.error(422, "invalid_input")
            val journeys = list.map { node ->
                val id = node.path("id").asText().takeIf { JOURNEY_ID.matches(it) } ?: return@on call.error(422, "invalid_input")
                val name = label(node.path("name")) ?: return@on call.error(422, "invalid_input")
                val window = window(node.path("window_days")) ?: return@on call.error(422, "invalid_input")
                val goals = goals(node.path("goals")) ?: return@on call.error(422, "invalid_input")
                mapOf("id" to id, "name" to name, "window_days" to window, "goals" to goals.map(::goalJson))
            }
            if (journeys.map { it["id"] }.toSet().size != journeys.size) return@on call.error(422, "invalid_input")
            store.write(row, Call.mapper.writeValueAsString(journeys))
            call.json(mapOf("journeys" to journeys))
        }
        // A journey computed for the players who arrived in the period: funnel, cohorts, retention, last actions.
        on(router, "journey", "POST") { call, reader, row, _ ->
            val body = call.body() ?: return@on call.error(422, "invalid_input")
            val from = body.path("from").takeIf { it.isIntegralNumber }?.asLong() ?: return@on call.error(422, "invalid_input")
            val to = body.path("to").takeIf { it.isIntegralNumber }?.asLong() ?: return@on call.error(422, "invalid_input")
            if (from < 0 || to <= from || to - from > MAX_JOURNEY_SECONDS) return@on call.error(422, "invalid_input")
            val window = window(body.path("window_days").takeUnless { it.isMissingNode } ?: Call.mapper.nodeFactory.numberNode(DEFAULT_WINDOW_DAYS)) ?: return@on call.error(422, "invalid_input")
            val goals = goals(body.path("goals").takeUnless { it.isMissingNode } ?: Call.mapper.createArrayNode()) ?: return@on call.error(422, "invalid_input")
            val key = listOf(row, from, to, window, goals, stats.zone())
            val now = stats.now()
            val cached = journeyCache[key]?.takeIf { now - it.first < JOURNEY_CACHE_SECONDS }
            val result = cached?.second ?: Journeys.compute({ f, t, events, each -> reader.scan(row, f, t, events, each) }, JourneyQuery(from, to, window, goals, stats.zone(), now)).also {
                if (journeyCache.size >= MAX_CACHED_JOURNEYS) journeyCache.clear()
                journeyCache[key] = now to it
            }
            call.json(journeyJson(result, cached?.first ?: now))
        }
        on(router, "events") { call, reader, row, _ ->
            val player = call.query("player")?.let { uuid(it) ?: return@on call.error(422, "invalid_input") }
            val from = call.query("from")?.let { instant(it) ?: return@on call.error(422, "invalid_input") }
            val to = call.query("to")?.let { instant(it) ?: return@on call.error(422, "invalid_input") }
            val cursor = call.query("cursor")?.let { it.toLongOrNull() ?: return@on call.error(422, "invalid_input") }
            val limit = call.query("limit")?.let { it.toIntOrNull()?.takeIf { n -> n in 1..MAX_PAGE } ?: return@on call.error(422, "invalid_input") } ?: 50
            val event = call.query("event")?.takeIf { it.isNotEmpty() }
            val page = reader.events(row, EventsQuery(event, from?.times(1000), to?.times(1000), player, cursor, limit))
            call.json(mapOf(
                "events" to page.rows.map {
                    mapOf(
                        "id" to it.id, "player" to it.player.ifEmpty { null }, "event" to it.event, "at" to it.at,
                        "dimensions" to it.dims, "value" to it.value,
                        "details" to runCatching { Call.mapper.readTree(it.details) }.getOrNull(),
                    )
                },
                "next" to page.next,
            ))
        }
    }

    private class Period(val event: String, val from: Long, val to: Long, val player: String?)

    /** `event`, `from`, `to` and the optional `player` of a bucket read; null when one is missing or wrong. */
    private fun period(call: Call): Period? {
        val event = call.query("event")?.takeIf { it.isNotEmpty() } ?: return null
        val from = call.query("from")?.let(::instant) ?: return null
        val to = call.query("to")?.let(::instant) ?: return null
        if (to <= from) return null
        val player = call.query("player")?.let { uuid(it) ?: return null }
        return Period(event, from, to, player)
    }

    private fun granularity(call: Call): Granularity? = when (call.query("by") ?: "hour") {
        "hour" -> Granularity.HOUR
        "day" -> Granularity.DAY
        else -> null
    }

    /** Epoch seconds of an epoch second or an ISO-8601 instant. */
    private fun instant(text: String): Long? =
        text.toLongOrNull()?.takeIf { it >= 0 } ?: runCatching { Instant.parse(text).epochSecond }.getOrNull()

    private fun uuid(text: String): String? = runCatching { UUID.fromString(text).toString() }.getOrNull()

    private val journeyCache = ConcurrentHashMap<List<Any>, Pair<Long, JourneyResult>>()

    private fun label(node: JsonNode): String? = node.takeIf { it.isTextual }?.asText()?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_LABEL }

    private fun window(node: JsonNode): Int? = node.takeIf { it.isIntegralNumber }?.asInt()?.takeIf { it in 1..MAX_WINDOW_DAYS }

    /** The goals of a journey as written by the editor; null when one is malformed. */
    private fun goals(node: JsonNode): List<JourneyGoal>? {
        if (!node.isArray || node.size() > MAX_GOALS) return null
        return node.map { goal ->
            val name = label(goal.path("name")) ?: return null
            val event = goal.path("event").asText().takeIf { StatEvent.NAME.matcher(it).matches() } ?: return null
            val dims = goal.path("dims")
            if (!dims.isMissingNode && !dims.isObject) return null
            if (dims.size() > StatEvent.MAX_DIMENSIONS) return null
            val filter = buildMap {
                for ((key, value) in dims.fields()) {
                    if (!StatEvent.FIELD.matcher(key).matches() || !value.isTextual || value.asText().length > MAX_VALUE) return null
                    put(key, value.asText())
                }
            }
            JourneyGoal(name, event, filter)
        }
    }

    private fun goalJson(goal: JourneyGoal) = mapOf("name" to goal.name, "event" to goal.event, "dims" to goal.dims)

    private fun retentionJson(points: List<RetentionPoint>) = points.map { mapOf("day" to it.day, "eligible" to it.eligible, "returned" to it.returned) }

    private fun journeyJson(r: JourneyResult, computedAt: Long) = mapOf(
        "arrivals" to r.arrivals,
        "steps" to r.steps.map { mapOf("name" to it.name, "players" to it.players, "median_seconds" to it.medianSeconds) },
        "retention" to retentionJson(r.retention),
        "retention_curve" to retentionJson(r.curve),
        "cohorts" to r.cohorts.map { mapOf("week_start" to it.weekStart, "arrivals" to it.arrivals, "reached" to it.reached, "retention" to retentionJson(it.retention)) },
        "leavers" to r.leavers,
        "away_days" to Journeys.AWAY_DAYS,
        "last_actions" to r.lastActions.map { mapOf("event" to it.event, "dimensions" to it.dims, "players" to it.players) },
        "computed_at" to computedAt,
    )

    private fun on(router: Router, suffix: String, method: String = "GET", handler: (Call, StatsReader, Int, EditorServer) -> Unit) {
        router.on(method, "${ServerRoutes.SERVER}/stats/$suffix", EditorPermissions.STATS) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            if (!stats.enabled()) return@on call.error(404, "stats_disabled")
            val reader = stats.reader() ?: return@on call.error(503, "stats_unavailable")
            val row = stats.rowOf(server.id) ?: return@on call.error(404, "not_found")
            try {
                handler(call, reader, row, server)
            } catch (e: Exception) {
                call.error(503, "stats_unavailable", e.message)
            }
        }
    }

    private companion object {
        const val MAX_PAGE = 200
        const val MAX_JOURNEYS = 30
        const val MAX_GOALS = 8
        const val MAX_LABEL = 80
        const val MAX_VALUE = 200
        const val MAX_WINDOW_DAYS = 90
        const val DEFAULT_WINDOW_DAYS = 7
        /** Raw rows are kept 90 days by default: a longer period of arrivals has nothing to read. */
        const val MAX_JOURNEY_SECONDS = 92L * 86_400
        const val JOURNEY_CACHE_SECONDS = 60
        const val MAX_CACHED_JOURNEYS = 50
        val JOURNEY_ID = Regex("[a-z0-9][a-z0-9_-]{0,39}")
    }
}
