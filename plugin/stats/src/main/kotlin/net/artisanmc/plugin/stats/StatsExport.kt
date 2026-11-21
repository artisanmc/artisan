package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.PlayerMetric

/** A metric value as exported: [at] is when it last changed, in epoch milliseconds. */
data class ExportedValue(val metric: String, val player: String, val value: Long, val at: Long)

/** A player as exported, from `artisan_players`: instants in epoch milliseconds. */
data class ExportedPlayer(val player: String, val name: String, val firstSeen: Long, val lastSeen: Long, val playtimeMs: Long)

/** A player's play time on one server, from `artisan_server_playtime`: [server] is its row in `artisan_servers`. */
data class ExportedServerTime(val server: Int, val player: String, val playtimeMs: Long, val lastSeen: Long)

/**
 * What the export reads (ADR `stats-export` ③): the values and the players that changed in
 * `(since, until]`, in a stable order, a page after the last row of the previous one.
 */
interface ExportSource {
    /** Ordered by time, metric, player; [after] is the previous page's last row, null for the first. */
    fun values(since: Long, until: Long, after: ExportedValue?, limit: Int): List<ExportedValue>

    /** Ordered by last seen, player; [after] is the previous page's last row, null for the first. */
    fun players(since: Long, until: Long, after: ExportedPlayer?, limit: Int): List<ExportedPlayer>

    /** Play time per server, ordered by last seen, server, player; [after] is the previous page's last row. */
    fun serverTimes(since: Long, until: Long, after: ExportedServerTime?, limit: Int): List<ExportedServerTime> = emptyList()

    /** The servers that have play time, by row: their names label their `core:playtime.s<row>` metrics. */
    fun servers(): Map<Int, String> = emptyMap()
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
        var lastTime: ExportedServerTime? = null
        var playersDone = false
        var valuesDone = false
        var timesDone = false
        while (true) {
            val playerPage = if (playersDone) emptyList() else source.players(since, until, lastPlayer, pageSize)
            if (playerPage.size < pageSize) playersDone = true
            lastPlayer = playerPage.lastOrNull() ?: lastPlayer
            val room = pageSize - playerPage.size
            val valuePage = if (valuesDone || room == 0) emptyList() else source.values(since, until, lastValue, room)
            if (!valuesDone && room > 0 && valuePage.size < room) valuesDone = true
            lastValue = valuePage.lastOrNull() ?: lastValue
            val left = room - valuePage.size
            val timePage = if (timesDone || !valuesDone || left == 0) emptyList() else source.serverTimes(since, until, lastTime, left)
            if (valuesDone && !timesDone && left > 0 && timePage.size < left) timesDone = true
            lastTime = timePage.lastOrNull() ?: lastTime
            val last = playersDone && valuesDone && timesDone
            val times = timePage.map { ExportedValue(serverPlaytime(it.server), it.player, it.playtimeMs / 1000, it.lastSeen) }
            val payload = Payload(playerPage, valuePage + times, if (pages == 0) declarations() else emptyList(), remote, if (last) until else null)
            val answered = parseCursor(transport.post(payload.json(server)))
            pages++
            players += playerPage.size
            values += valuePage.count { it.metric != FORGOTTEN } + times.size
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
        val answered = parseCursor(transport.post(Payload(emptyList(), emptyList(), declarations(), null, null).json(server)))
        cursor = answered
        return answered
    }

    /**
     * The declared metrics, then one `core:playtime.s<row>` per server with play time: `parent`
     * `core:playtime` and `scope` the server's name, so a website shows them as tabs of the network
     * total. Keyed by the server's row, the id outlives a rename; the labels follow it.
     */
    private fun declarations(): List<ExportedMetric> {
        val declared = metrics().map { ExportedMetric(it.id, it.unit.name.lowercase(), it.isRanked, it.isAscending, it.labels, cumulative = it.isCumulative) }
        val playtime = declared.firstOrNull { it.id == PLAYTIME }
        val servers = source.servers().entries.sortedBy { it.key }.map { (row, name) ->
            ExportedMetric(
                serverPlaytime(row), "seconds", playtime?.ranked ?: true, false,
                mapOf("en" to "Play time on $name".take(MAX_LABEL), "fr" to "Temps de jeu sur $name".take(MAX_LABEL)),
                cumulative = true, parent = PLAYTIME, scope = name.take(MAX_LABEL),
            )
        }
        return declared + servers
    }

    /** A metric as the website receives it. */
    private class ExportedMetric(
        val id: String, val unit: String, val ranked: Boolean, val ascending: Boolean, val labels: Map<String, String>,
        val cumulative: Boolean = false, val parent: String? = null, val scope: String? = null,
    )

    /**
     * One page. The website applies `forget` before the rest: a player seen again after being
     * forgotten comes back. A player row older than its player's forgetting in the same page is
     * left out, else it would bring them back.
     */
    private class Payload(players: List<ExportedPlayer>, values: List<ExportedValue>, val metrics: List<ExportedMetric>, val since: Long?, val cursor: Long?) {
        private val forgotten = values.filter { it.metric == FORGOTTEN }.associate { it.player to it.at }
        val players = players.filter { p -> forgotten[p.player]?.let { p.lastSeen > it } ?: true }
        val values = values.filter { v -> v.metric == FORGOTTEN || (forgotten[v.player]?.let { v.at > it } ?: true) }

        fun json(server: String): String = buildString {
            append("{\"protocol\":").append(PROTOCOL)
            append(",\"server\":").append(quote(server))
            append(",\"since\":").append(since?.toString() ?: "null")
            append(",\"cursor\":").append(cursor?.toString() ?: "null")
            append(",\"metrics\":[")
            metrics.forEachIndexed { i, m ->
                if (i > 0) append(',')
                append("{\"id\":").append(quote(m.id))
                append(",\"unit\":").append(quote(m.unit))
                append(",\"ranked\":").append(m.ranked)
                append(",\"ascending\":").append(m.ascending)
                if (m.cumulative) append(",\"cumulative\":true")
                if (m.parent != null) append(",\"parent\":").append(quote(m.parent))
                if (m.scope != null) append(",\"scope\":").append(quote(m.scope))
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
        private const val MAX_LABEL = 64

        /** The metric of the play time on the server of row [row] in `artisan_servers`. */
        fun serverPlaytime(row: Int) = "$PLAYTIME.s$row"
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
