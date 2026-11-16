package net.artisanmc.plugin.hub

import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.plugin.stats.BreakdownQuery
import net.artisanmc.plugin.stats.EventsQuery
import net.artisanmc.plugin.stats.Granularity
import net.artisanmc.plugin.stats.SeriesQuery
import net.artisanmc.plugin.stats.StatsReader
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

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
)

/**
 * `GET /api/v1/servers/:server/stats/…` (ADR `stats-foundation` ⑧), behind `artisan.editor.stats`.
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
            call.json(mapOf("events" to reader.catalog(row).map { entry ->
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

    private fun on(router: Router, suffix: String, handler: (Call, StatsReader, Int, EditorServer) -> Unit) {
        router.on("GET", "${ServerRoutes.SERVER}/stats/$suffix", EditorPermissions.STATS) { call ->
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
    }
}
