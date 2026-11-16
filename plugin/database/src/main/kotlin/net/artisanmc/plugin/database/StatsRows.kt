package net.artisanmc.plugin.database

import net.artisanmc.plugin.stats.Actives
import net.artisanmc.plugin.stats.BreakdownQuery
import net.artisanmc.plugin.stats.BreakdownRow
import net.artisanmc.plugin.stats.BucketRow
import net.artisanmc.plugin.stats.CatalogEntry
import net.artisanmc.plugin.stats.Dimensions
import net.artisanmc.plugin.stats.EventRow
import net.artisanmc.plugin.stats.EventsPage
import net.artisanmc.plugin.stats.EventsQuery
import net.artisanmc.plugin.stats.Granularity
import net.artisanmc.plugin.stats.Rollup
import net.artisanmc.plugin.stats.SeriesPoint
import net.artisanmc.plugin.stats.SeriesQuery
import net.artisanmc.plugin.stats.StatsBatch
import net.artisanmc.plugin.stats.StatsQueries
import net.artisanmc.plugin.stats.StatsReader
import net.artisanmc.plugin.stats.StatsWriter
import java.sql.Connection
import java.sql.PreparedStatement
import java.time.ZoneId
import javax.sql.DataSource

/**
 * `artisan_stats_buckets` and `artisan_stats_events` (ADR `stats-foundation` ⑤⑥⑧⑨). Plain SQL that
 * H2, MySQL and MariaDB all run: a bucket is added to by `UPDATE`, then inserted when no row moved.
 * Only the server owning a `server_id` writes its rows ([writer]), so the two never race.
 */
class StatsRows(
    private val dataSource: DataSource,
    private val t: ArtisanTables = ArtisanTables.DEFAULT,
) : StatsReader {
    /** What [server] (its row in `artisan_servers`) writes. */
    fun writer(server: Int): StatsWriter = Writer(server)

    /** Deletes [player]'s rows in both tables, on every server; the number of rows deleted. */
    fun forget(player: String): Int = dataSource.connection.use { c ->
        transaction(c) {
            listOf(t.statsBuckets, t.statsEvents).sumOf { table ->
                c.prepareStatement("DELETE FROM $table WHERE player_uuid = ?").use { it.setString(1, player); it.executeUpdate() }
            }
        }
    }

    private inner class Writer(private val server: Int) : StatsWriter {
        override fun write(batch: StatsBatch) {
            if (batch.isEmpty()) return
            dataSource.connection.use { c ->
                transaction(c) {
                    addBuckets(c, server, batch.buckets)
                    if (batch.raws.isNotEmpty()) {
                        c.prepareStatement(
                            "INSERT INTO ${t.statsEvents} (server_id, player_uuid, event, occurred_at, dims, val, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        ).use { s ->
                            for (r in batch.raws) {
                                s.setInt(1, server); s.setString(2, r.player); s.setString(3, r.event); s.setLong(4, r.at)
                                s.setString(5, r.dims); s.setDouble(6, r.value); s.setString(7, r.details)
                                s.addBatch()
                            }
                            s.executeBatch()
                        }
                    }
                }
            }
        }

        override fun rollup(before: Long, zone: ZoneId): Int {
            var days = 0
            while (days < MAX_DAYS_PER_ROLLUP) {
                val first = dataSource.connection.use { c ->
                    c.prepareStatement("SELECT MIN(bucket_start) FROM ${t.statsBuckets} WHERE server_id = ? AND granularity = ? AND bucket_start < ?").use { s ->
                        s.setInt(1, server); s.setString(2, Granularity.HOUR.code); s.setLong(3, before)
                        s.executeQuery().use { r -> if (r.next()) r.getLong(1).takeUnless { r.wasNull() } else null }
                    }
                } ?: break
                val dayStart = Rollup.dayStart(first, zone)
                val end = minOf(Rollup.nextDay(dayStart, zone), before)
                dataSource.connection.use { c ->
                    transaction(c) {
                        val hours = c.prepareStatement(
                            "SELECT player_uuid, event, dims, bucket_start, cnt, total, min_v, max_v FROM ${t.statsBuckets} " +
                                "WHERE server_id = ? AND granularity = ? AND bucket_start >= ? AND bucket_start < ?",
                        ).use { s ->
                            s.setInt(1, server); s.setString(2, Granularity.HOUR.code); s.setLong(3, first); s.setLong(4, end)
                            s.executeQuery().use { r ->
                                buildList {
                                    while (r.next()) add(BucketRow(r.getString(1), r.getString(2), r.getString(3), r.getLong(4), Granularity.HOUR, r.getLong(5), r.getDouble(6), r.getDouble(7), r.getDouble(8)))
                                }
                            }
                        }
                        addBuckets(c, server, Rollup.days(hours, zone))
                        c.prepareStatement("DELETE FROM ${t.statsBuckets} WHERE server_id = ? AND granularity = ? AND bucket_start >= ? AND bucket_start < ?").use { s ->
                            s.setInt(1, server); s.setString(2, Granularity.HOUR.code); s.setLong(3, first); s.setLong(4, end)
                            s.executeUpdate()
                        }
                    }
                }
                days++
            }
            return days
        }

        override fun purgeDays(before: Long): Int = dataSource.connection.use { c ->
            c.prepareStatement("DELETE FROM ${t.statsBuckets} WHERE server_id = ? AND granularity = ? AND bucket_start < ?").use { s ->
                s.setInt(1, server); s.setString(2, Granularity.DAY.code); s.setLong(3, before)
                s.executeUpdate()
            }
        }

        override fun purgeRaw(before: Long, perEvent: Map<String, Long>): Int = dataSource.connection.use { c ->
            val own = perEvent.keys.toList()
            val notOwn = if (own.isEmpty()) "" else " AND event NOT IN (${own.joinToString { "?" }})"
            var deleted = c.prepareStatement("DELETE FROM ${t.statsEvents} WHERE server_id = ? AND occurred_at < ?$notOwn").use { s ->
                s.setInt(1, server); s.setLong(2, before)
                own.forEachIndexed { i, e -> s.setString(3 + i, e) }
                s.executeUpdate()
            }
            for ((event, cutoff) in perEvent) {
                deleted += c.prepareStatement("DELETE FROM ${t.statsEvents} WHERE server_id = ? AND event = ? AND occurred_at < ?").use { s ->
                    s.setInt(1, server); s.setString(2, event); s.setLong(3, cutoff)
                    s.executeUpdate()
                }
            }
            deleted
        }
    }

    /**
     * Adds [rows] to their buckets: an `UPDATE` per row, then one `INSERT` batch for the rows no
     * update reached. The updates run one by one because a batch's update counts are not reliable
     * on MySQL and MariaDB with `rewriteBatchedStatements` (`SUCCESS_NO_INFO`).
     */
    private fun addBuckets(c: Connection, server: Int, rows: List<BucketRow>) {
        if (rows.isEmpty()) return
        val hashes = rows.map { sha256(it.dims.toByteArray(Charsets.UTF_8)) }
        val counts = c.prepareStatement(
            "UPDATE ${t.statsBuckets} SET cnt = cnt + ?, total = total + ?, " +
                "min_v = CASE WHEN min_v < ? THEN min_v ELSE ? END, max_v = CASE WHEN max_v > ? THEN max_v ELSE ? END " +
                "WHERE server_id = ? AND event = ? AND bucket_start = ? AND granularity = ? AND player_uuid = ? AND dims_hash = ?",
        ).use { s ->
            rows.mapIndexed { i, r ->
                s.setLong(1, r.count); s.setDouble(2, r.sum); s.setDouble(3, r.min); s.setDouble(4, r.min); s.setDouble(5, r.max); s.setDouble(6, r.max)
                key(s, 7, server, r, hashes[i])
                s.executeUpdate()
            }
        }
        val missing = rows.indices.filter { counts[it] == 0 }
        if (missing.isEmpty()) return
        c.prepareStatement(
            "INSERT INTO ${t.statsBuckets} (cnt, total, min_v, max_v, dims, server_id, event, bucket_start, granularity, player_uuid, dims_hash) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).use { s ->
            for (i in missing) {
                val r = rows[i]
                s.setLong(1, r.count); s.setDouble(2, r.sum); s.setDouble(3, r.min); s.setDouble(4, r.max); s.setString(5, r.dims)
                key(s, 6, server, r, hashes[i])
                s.addBatch()
            }
            s.executeBatch()
        }
    }

    private fun key(s: PreparedStatement, from: Int, server: Int, r: BucketRow, hash: String) {
        s.setInt(from, server); s.setString(from + 1, r.event); s.setLong(from + 2, r.start)
        s.setString(from + 3, r.granularity.code); s.setString(from + 4, r.player); s.setString(from + 5, hash)
    }

    override fun catalog(server: Int): List<CatalogEntry> = dataSource.connection.use { c ->
        fun names(table: String) = c.prepareStatement("SELECT DISTINCT event FROM $table WHERE server_id = ?").use { s ->
            s.setInt(1, server)
            s.executeQuery().use { r -> buildSet { while (r.next()) add(r.getString(1)) } }
        }
        val bucketed = names(t.statsBuckets)
        val raw = names(t.statsEvents)
        (bucketed + raw).sorted().map { CatalogEntry(it, it in bucketed, it in raw) }
    }

    override fun series(server: Int, q: SeriesQuery): List<SeriesPoint> =
        StatsQueries.series(grouped(server, q.event, q.from, q.to, q.player, "bucket_start, granularity, dims"), q)

    override fun breakdown(server: Int, q: BreakdownQuery): List<BreakdownRow> =
        StatsQueries.breakdown(grouped(server, q.event, q.from, q.to, q.player, "dims"), q)

    override fun actives(server: Int, q: SeriesQuery): Actives = dataSource.connection.use { c ->
        // One row per player and bucket (and dimensions, only when a filter reads them): the fold counts each player once.
        val dims = if (q.dims.isEmpty()) "''" else "dims"
        val sql = "SELECT DISTINCT player_uuid, bucket_start, granularity, $dims FROM ${t.statsBuckets} " +
            "WHERE server_id = ? AND event = ? AND bucket_start >= ? AND bucket_start < ? AND player_uuid <> ''" +
            (if (q.player != null) " AND player_uuid = ?" else "")
        c.prepareStatement(sql).use { s ->
            s.setInt(1, server); s.setString(2, q.event); s.setLong(3, q.from); s.setLong(4, q.to)
            if (q.player != null) s.setString(5, q.player)
            s.executeQuery().use { r ->
                StatsQueries.actives(
                    buildList { while (r.next()) add(BucketRow(r.getString(1), q.event, r.getString(4), r.getLong(2), Granularity.of(r.getString(3)), 0, 0.0, 0.0, 0.0)) },
                    q,
                )
            }
        }
    }

    /** The buckets of [event] summed over players, grouped by [by]: what the folds of [StatsQueries] read. */
    private fun grouped(server: Int, event: String, from: Long, to: Long, player: String?, by: String): List<BucketRow> = dataSource.connection.use { c ->
        val withStart = by.startsWith("bucket_start")
        val select = if (withStart) "bucket_start, granularity, dims" else "dims"
        val sql = "SELECT $select, SUM(cnt), SUM(total), MIN(min_v), MAX(max_v) FROM ${t.statsBuckets} " +
            "WHERE server_id = ? AND event = ? AND bucket_start >= ? AND bucket_start < ?" +
            (if (player != null) " AND player_uuid = ?" else "") + " GROUP BY $by"
        c.prepareStatement(sql).use { s ->
            s.setInt(1, server); s.setString(2, event); s.setLong(3, from); s.setLong(4, to)
            if (player != null) s.setString(5, player)
            s.executeQuery().use { r ->
                buildList {
                    while (r.next()) {
                        val o = if (withStart) 2 else 0
                        add(
                            BucketRow(
                                "", event, r.getString(1 + o),
                                if (withStart) r.getLong(1) else from,
                                if (withStart) Granularity.of(r.getString(2)) else Granularity.HOUR,
                                r.getLong(2 + o), r.getDouble(3 + o), r.getDouble(4 + o), r.getDouble(5 + o),
                            ),
                        )
                    }
                }
            }
        }
    }

    override fun events(server: Int, q: EventsQuery): EventsPage = dataSource.connection.use { c ->
        val where = StringBuilder("server_id = ?")
        val args = mutableListOf<Any>(server)
        q.event?.let { where.append(" AND event = ?"); args += it }
        q.player?.let { where.append(" AND player_uuid = ?"); args += it }
        q.from?.let { where.append(" AND occurred_at >= ?"); args += it }
        q.to?.let { where.append(" AND occurred_at < ?"); args += it }
        q.before?.let { where.append(" AND id < ?"); args += it }
        val limit = q.limit.coerceIn(1, MAX_PAGE)
        c.prepareStatement(
            "SELECT id, player_uuid, event, occurred_at, dims, val, details FROM ${t.statsEvents} WHERE $where ORDER BY id DESC LIMIT ${limit + 1}",
        ).use { s ->
            args.forEachIndexed { i, a ->
                when (a) {
                    is Int -> s.setInt(i + 1, a)
                    is Long -> s.setLong(i + 1, a)
                    else -> s.setString(i + 1, a.toString())
                }
            }
            s.executeQuery().use { r ->
                val rows = buildList {
                    while (r.next()) add(EventRow(r.getLong(1), r.getString(2), r.getString(3), r.getLong(4), Dimensions.decode(r.getString(5)), r.getDouble(6), r.getString(7)))
                }
                if (rows.size > limit) EventsPage(rows.take(limit), rows[limit - 1].id) else EventsPage(rows, null)
            }
        }
    }

    companion object {
        /** Days merged per run: a server that never ran the rollup catches up over a few days. */
        const val MAX_DAYS_PER_ROLLUP = 400
        const val MAX_PAGE = 200
    }
}
