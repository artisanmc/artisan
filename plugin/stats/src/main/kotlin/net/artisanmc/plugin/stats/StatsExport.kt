package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.PlayerMetric

/** A metric value as exported: [at] is when it last changed, in epoch milliseconds. */
data class ExportedValue(val metric: String, val player: String, val value: Long, val at: Long)

/** A player as exported, from `artisan_players`: instants in epoch milliseconds. */
data class ExportedPlayer(val player: String, val name: String, val firstSeen: Long, val lastSeen: Long, val playtimeMs: Long)

/**
 * What the export reads (ADR `stats-export` ③): the values and the players that changed in
 * `(since, until]`, in a stable order, a page after the last row of the previous one.
 */
interface ExportSource {
    /** Ordered by time, metric, player; [after] is the previous page's last row, null for the first. */
    fun values(since: Long, until: Long, after: ExportedValue?, limit: Int): List<ExportedValue>

    /** Ordered by last seen, player; [after] is the previous page's last row, null for the first. */
    fun players(since: Long, until: Long, after: ExportedPlayer?, limit: Int): List<ExportedPlayer>
}

/** Sends one JSON payload to the website and returns the body of its answer; throws on a refusal or a network error. */
fun interface ExportTransport {
    fun post(json: String): String
}

/** What one run of the export did. */
data class ExportRun(val pages: Int, val values: Int, val players: Int, val forgotten: Int, val cursor: Long, val resync: Boolean = false)

/**
 * The export of player metrics to the admin's website (ADR `stats-export`): a push of what changed,
 * never a port opened on the game server. The **website keeps the cursor**: the instant up to which
 * it holds everything. Each run sends the rows changed since that cursor (minus [overlapMs], for
 * the clocks of the servers that wrote them), a page at a time, then the new cursor with the last
 * page. Payloads are idempotent upserts, so a page sent twice changes nothing; a run cut short is
 * replayed from the same cursor by the next. Each page carries `since`, the cursor it was built
 * from: a website whose own cursor is older (it lost its data) keeps its own and answers it, and
 * the next run sends everything again.
 */
class StatsExport(
    private val source: ExportSource,
    private val transport: ExportTransport,
    private val metrics: () -> List<PlayerMetric>,
    private val server: String,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pageSize: Int = PAGE_SIZE,
    private val overlapMs: Long = OVERLAP_MS,
) {
    /** The website's cursor as last answered; null until the first answer. */
    @Volatile var cursor: Long? = null
        private set

    /** One run; throws when the website cannot be reached or refuses a page (the next run starts over from [cursor]). */
    fun run(): ExportRun {
        val remote = cursor ?: hello()
        // A row written in this very millisecond could still be followed by another one of the same instant.
        val until = clock() - SETTLE_MS
        val since = if (remote <= 0) Long.MIN_VALUE else remote - overlapMs
        var pages = 0
        var values = 0
        var players = 0
        var forgotten = 0
        var lastPlayer: ExportedPlayer? = null
        var lastValue: ExportedValue? = null
        var playersDone = false
        var valuesDone = false
        while (true) {
            val playerPage = if (playersDone) emptyList() else source.players(since, until, lastPlayer, pageSize)
            if (playerPage.size < pageSize) playersDone = true
            lastPlayer = playerPage.lastOrNull() ?: lastPlayer
            val room = pageSize - playerPage.size
            val valuePage = if (valuesDone || room == 0) emptyList() else source.values(since, until, lastValue, room)
            if (!valuesDone && room > 0 && valuePage.size < room) valuesDone = true
            lastValue = valuePage.lastOrNull() ?: lastValue
            val last = playersDone && valuesDone
            val payload = Payload(playerPage, valuePage, if (pages == 0) metrics() else emptyList(), remote, if (last) until else null)
            val answered = parseCursor(transport.post(payload.json(server)))
            pages++
            players += playerPage.size
            values += valuePage.count { it.metric != FORGOTTEN }
            forgotten += valuePage.count { it.metric == FORGOTTEN }
            if (answered < remote) {
                // The website lost what it held: everything again, from the start, next run.
                cursor = answered
                return ExportRun(pages, values, players, forgotten, answered, resync = true)
            }
            if (last) {
                cursor = answered
                return ExportRun(pages, values, players, forgotten, answered)
            }
        }
    }

    /** The website's cursor, asked with an empty payload that also declares the metrics. */
    private fun hello(): Long {
        val answered = parseCursor(transport.post(Payload(emptyList(), emptyList(), metrics(), null, null).json(server)))
        cursor = answered
        return answered
    }

    /**
     * One page. The website applies `forget` before the rest: a player seen again after being
     * forgotten comes back. A player row older than its player's forgetting in the same page is
     * left out, else it would bring them back.
     */
    private class Payload(players: List<ExportedPlayer>, val values: List<ExportedValue>, val metrics: List<PlayerMetric>, val since: Long?, val cursor: Long?) {
        private val forgotten = values.filter { it.metric == FORGOTTEN }.associate { it.player to it.at }
        val players = players.filter { p -> forgotten[p.player]?.let { p.lastSeen > it } ?: true }

        fun json(server: String): String = buildString {
            append("{\"protocol\":").append(PROTOCOL)
            append(",\"server\":").append(quote(server))
            append(",\"since\":").append(since?.toString() ?: "null")
            append(",\"cursor\":").append(cursor?.toString() ?: "null")
            append(",\"metrics\":[")
            metrics.forEachIndexed { i, m ->
                if (i > 0) append(',')
                append("{\"id\":").append(quote(m.id))
                append(",\"unit\":").append(quote(m.unit.name.lowercase()))
                append(",\"ranked\":").append(m.isRanked)
                append(",\"ascending\":").append(m.isAscending)
                append(",\"labels\":{")
                m.labels.entries.sortedBy { it.key }.forEachIndexed { j, (k, v) ->
                    if (j > 0) append(',')
                    append(quote(k)).append(':').append(quote(v))
                }
                append("}}")
            }
            append("],\"players\":[")
            players.forEachIndexed { i, p ->
                if (i > 0) append(',')
                append("{\"uuid\":").append(quote(p.player))
                append(",\"name\":").append(quote(p.name))
                append(",\"first_seen\":").append(p.firstSeen / 1000)
                append(",\"last_seen\":").append(p.lastSeen / 1000)
                append('}')
            }
            // Play time lives in `artisan_players`: it travels as the `core:playtime` metric.
            val all = players.map { ExportedValue(PLAYTIME, it.player, it.playtimeMs / 1000, it.lastSeen) } + values.filter { it.metric != FORGOTTEN }
            append("],\"values\":[")
            all.forEachIndexed { i, v ->
                if (i > 0) append(',')
                append("{\"metric\":").append(quote(v.metric))
                append(",\"uuid\":").append(quote(v.player))
                append(",\"value\":").append(v.value)
                append('}')
            }
            append("],\"forget\":[")
            forgotten.keys.forEachIndexed { i, player ->
                if (i > 0) append(',')
                append(quote(player))
            }
            append("]}")
        }
    }

    companion object {
        /** The payload's shape; the website refuses one it does not know. */
        const val PROTOCOL = 1
        /** `core:playtime`, read from `artisan_players` rather than set. */
        const val PLAYTIME = "core:playtime"
        /** The row `/artisan stats forget` leaves in `artisan_metric_values`: the website deletes the player. */
        const val FORGOTTEN = "core:forgotten"
        const val PAGE_SIZE = 2000
        /** How far back each run looks again: the servers' clocks may differ by this much. */
        const val OVERLAP_MS = 120_000L
        private const val SETTLE_MS = 1_000L
        private val CURSOR = Regex("\"cursor\"\\s*:\\s*(-?\\d+)")

        /** The website's `{"cursor": n}`; anything else is a refusal. */
        fun parseCursor(body: String): Long =
            CURSOR.find(body)?.groupValues?.get(1)?.toLongOrNull()
                ?: throw IllegalStateException("the website answered without a cursor: ${body.take(200)}")

        private fun quote(s: String) = buildString(s.length + 2) {
            append('"')
            for (c in s) when {
                c == '"' -> append("\\\"")
                c == '\\' -> append("\\\\")
                c == '\n' -> append("\\n")
                c == '\r' -> append("\\r")
                c == '\t' -> append("\\t")
                c < ' ' -> append("\\u%04x".format(c.code))
                else -> append(c)
            }
            append('"')
        }
    }
}
