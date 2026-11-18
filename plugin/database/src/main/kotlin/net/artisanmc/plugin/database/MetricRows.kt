package net.artisanmc.plugin.database

import net.artisanmc.plugin.stats.ExportSource
import net.artisanmc.plugin.stats.ExportedPlayer
import net.artisanmc.plugin.stats.ExportedServerTime
import net.artisanmc.plugin.stats.ExportedValue
import net.artisanmc.plugin.stats.MetricValue
import net.artisanmc.plugin.stats.MetricWriter
import net.artisanmc.plugin.stats.StatsExport
import java.sql.Connection
import java.sql.SQLException
import javax.sql.DataSource

/**
 * `artisan_metric_values` (ADR `stats-export`): each player's latest value of each declared
 * metric, shared by the servers of the network, and what the export reads of it, of
 * `artisan_players` and of `artisan_server_playtime`. `updated_at` moves only when a value changes, so the export sends only what
 * changed. Plain SQL that H2, MySQL and MariaDB all run.
 */
class MetricRows(
    private val dataSource: DataSource,
    private val t: ArtisanTables = ArtisanTables.DEFAULT,
) : MetricWriter, ExportSource {

    /**
     * Writes [values] at [now]: an `UPDATE` that only touches a different value, then an `INSERT`
     * when the row does not exist. Two servers inserting the same new row at once: the second
     * insert fails on the key and is ignored, the first value stands until the next set.
     */
    override fun write(values: List<MetricValue>, now: Long) {
        if (values.isEmpty()) return
        dataSource.connection.use { c ->
            for (v in values) {
                val moved = c.prepareStatement(
                    "UPDATE ${t.metricValues} SET val = ?, updated_at = ? WHERE metric = ? AND player_uuid = ? AND val <> ?",
                ).use { s ->
                    s.setLong(1, v.value); s.setLong(2, now); s.setString(3, v.metric); s.setString(4, v.player); s.setLong(5, v.value)
                    s.executeUpdate()
                }
                if (moved == 0 && !exists(c, v.metric, v.player)) insert(c, v.metric, v.player, v.value, now)
            }
        }
    }

    /** [player]'s value of [metric], or null. */
    fun get(metric: String, player: String): Long? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT val FROM ${t.metricValues} WHERE metric = ? AND player_uuid = ?").use { s ->
            s.setString(1, metric); s.setString(2, player)
            s.executeQuery().use { r -> if (r.next()) r.getLong(1) else null }
        }
    }

    /**
     * Deletes [player]'s values (`/artisan stats forget`) and leaves the [StatsExport.FORGOTTEN]
     * row at [now], which tells the website to delete them too. The number of values deleted.
     */
    fun forget(player: String, now: Long): Int = dataSource.connection.use { c ->
        transaction(c) {
            val deleted = c.prepareStatement("DELETE FROM ${t.metricValues} WHERE player_uuid = ?").use { s ->
                s.setString(1, player)
                s.executeUpdate()
            }
            insert(c, StatsExport.FORGOTTEN, player, 0, now)
            deleted
        }
    }

    override fun values(since: Long, until: Long, after: ExportedValue?, limit: Int): List<ExportedValue> = dataSource.connection.use { c ->
        val page = if (after == null) "" else " AND (updated_at > ? OR (updated_at = ? AND (metric > ? OR (metric = ? AND player_uuid > ?))))"
        c.prepareStatement(
            "SELECT metric, player_uuid, val, updated_at FROM ${t.metricValues} WHERE updated_at > ? AND updated_at <= ?$page " +
                "ORDER BY updated_at, metric, player_uuid LIMIT ${limit.coerceIn(1, MAX_PAGE)}",
        ).use { s ->
            s.setLong(1, since); s.setLong(2, until)
            if (after != null) {
                s.setLong(3, after.at); s.setLong(4, after.at); s.setString(5, after.metric); s.setString(6, after.metric); s.setString(7, after.player)
            }
            s.executeQuery().use { r ->
                buildList { while (r.next()) add(ExportedValue(r.getString(1), r.getString(2).trim(), r.getLong(3), r.getLong(4))) }
            }
        }
    }

    override fun players(since: Long, until: Long, after: ExportedPlayer?, limit: Int): List<ExportedPlayer> = dataSource.connection.use { c ->
        val page = if (after == null) "" else " AND (last_seen > ? OR (last_seen = ? AND player_uuid > ?))"
        c.prepareStatement(
            "SELECT player_uuid, name, first_seen, last_seen, playtime_ms FROM ${t.players} WHERE last_seen > ? AND last_seen <= ?$page " +
                "ORDER BY last_seen, player_uuid LIMIT ${limit.coerceIn(1, MAX_PAGE)}",
        ).use { s ->
            s.setLong(1, since); s.setLong(2, until)
            if (after != null) {
                s.setLong(3, after.lastSeen); s.setLong(4, after.lastSeen); s.setString(5, after.player)
            }
            s.executeQuery().use { r ->
                buildList { while (r.next()) add(ExportedPlayer(r.getString(1).trim(), r.getString(2), r.getLong(3), r.getLong(4), r.getLong(5))) }
            }
        }
    }

    override fun serverTimes(since: Long, until: Long, after: ExportedServerTime?, limit: Int): List<ExportedServerTime> = dataSource.connection.use { c ->
        val page = if (after == null) "" else " AND (last_seen > ? OR (last_seen = ? AND (server_id > ? OR (server_id = ? AND player_uuid > ?))))"
        c.prepareStatement(
            "SELECT server_id, player_uuid, playtime_ms, last_seen FROM ${t.serverPlaytime} WHERE last_seen > ? AND last_seen <= ?$page " +
                "ORDER BY last_seen, server_id, player_uuid LIMIT ${limit.coerceIn(1, MAX_PAGE)}",
        ).use { s ->
            s.setLong(1, since); s.setLong(2, until)
            if (after != null) {
                s.setLong(3, after.lastSeen); s.setLong(4, after.lastSeen); s.setInt(5, after.server); s.setInt(6, after.server); s.setString(7, after.player)
            }
            s.executeQuery().use { r ->
                buildList { while (r.next()) add(ExportedServerTime(r.getInt(1), r.getString(2).trim(), r.getLong(3), r.getLong(4))) }
            }
        }
    }

    override fun servers(): Map<Int, String> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT id, name FROM ${t.servers} WHERE id IN (SELECT DISTINCT server_id FROM ${t.serverPlaytime})").use { s ->
            s.executeQuery().use { r -> buildMap { while (r.next()) put(r.getInt(1), r.getString(2)) } }
        }
    }

    private fun exists(c: Connection, metric: String, player: String): Boolean =
        c.prepareStatement("SELECT 1 FROM ${t.metricValues} WHERE metric = ? AND player_uuid = ?").use { s ->
            s.setString(1, metric); s.setString(2, player)
            s.executeQuery().use { it.next() }
        }

    private fun insert(c: Connection, metric: String, player: String, value: Long, now: Long) {
        try {
            c.prepareStatement("INSERT INTO ${t.metricValues} (metric, player_uuid, val, updated_at) VALUES (?, ?, ?, ?)").use { s ->
                s.setString(1, metric); s.setString(2, player); s.setLong(3, value); s.setLong(4, now)
                s.executeUpdate()
            }
        } catch (e: SQLException) {
            // Another server inserted the same row in between (23000: integrity constraint).
            if (e.sqlState?.startsWith("23") != true) throw e
            if (metric == StatsExport.FORGOTTEN) {
                c.prepareStatement("UPDATE ${t.metricValues} SET updated_at = ? WHERE metric = ? AND player_uuid = ?").use { s ->
                    s.setLong(1, now); s.setString(2, metric); s.setString(3, player)
                    s.executeUpdate()
                }
            }
        }
    }

    companion object {
        const val MAX_PAGE = 5000
    }
}
