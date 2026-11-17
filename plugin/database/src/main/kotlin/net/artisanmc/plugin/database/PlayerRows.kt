package net.artisanmc.plugin.database

import java.util.UUID
import javax.sql.DataSource

/** One row of `artisan_players`: instants and the play time in epoch milliseconds. */
data class PlayerRow(
    val id: UUID,
    val name: String,
    val firstSeen: Long,
    /** The last instant the player was seen online, on any server of the network. */
    val lastSeen: Long,
    val playtimeMs: Long,
)

/**
 * `artisan_players`: every player seen on the network, shared by its servers. Read when a player
 * logs in, written when they join, every few minutes while online (play time) and when they quit.
 */
class PlayerRows(
    private val dataSource: DataSource,
    private val t: ArtisanTables = ArtisanTables.DEFAULT,
) {
    fun get(id: UUID): PlayerRow? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT name, first_seen, last_seen, playtime_ms FROM ${t.players} WHERE player_uuid = ?").use { s ->
            s.setString(1, id.toString())
            s.executeQuery().use { r ->
                if (r.next()) PlayerRow(id, r.getString(1), r.getLong(2), r.getLong(3), r.getLong(4)) else null
            }
        }
    }

    /** The player last seen under [name] (case-insensitive), or null: names change hands, the latest holder wins. */
    fun findByName(name: String): UUID? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT player_uuid FROM ${t.players} WHERE LOWER(name) = ? ORDER BY last_seen DESC").use { s ->
            s.setString(1, name.lowercase())
            s.executeQuery().use { r -> if (r.next()) runCatching { UUID.fromString(r.getString(1).trim()) }.getOrNull() else null }
        }
    }

    /** The players whose name starts with [prefix] (case-insensitive), most recently seen first: id to name. */
    fun search(prefix: String, limit: Int): List<Pair<UUID, String>> = dataSource.connection.use { c ->
        // LIKE's own wildcards are escaped: a name may hold `_`.
        val pattern = prefix.lowercase().replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        c.prepareStatement("SELECT player_uuid, name FROM ${t.players} WHERE LOWER(name) LIKE ? ESCAPE '!' ORDER BY last_seen DESC LIMIT ${limit.coerceIn(1, 50)}").use { s ->
            s.setString(1, pattern)
            s.executeQuery().use { r -> pairs(r) }
        }
    }

    /** The names of [ids], for those the table knows. */
    fun names(ids: Collection<UUID>): List<Pair<UUID, String>> {
        if (ids.isEmpty()) return emptyList()
        return dataSource.connection.use { c ->
            c.prepareStatement("SELECT player_uuid, name FROM ${t.players} WHERE player_uuid IN (${ids.joinToString { "?" }})").use { s ->
                ids.forEachIndexed { i, id -> s.setString(i + 1, id.toString()) }
                s.executeQuery().use { r -> pairs(r) }
            }
        }
    }

    private fun pairs(r: java.sql.ResultSet): List<Pair<UUID, String>> = buildList {
        while (r.next()) runCatching { UUID.fromString(r.getString(1).trim()) }.getOrNull()?.let { add(it to r.getString(2)) }
    }

    /**
     * [id] is online as [name] at [now]: a new row on their first visit (first seen at [firstSeen],
     * the server's own record of them when it predates the table), else the name and last seen updated.
     */
    fun seen(id: UUID, name: String, now: Long, firstSeen: Long = now) = dataSource.connection.use { c ->
        val updated = c.prepareStatement("UPDATE ${t.players} SET name = ?, last_seen = ? WHERE player_uuid = ?").use {
            it.setString(1, name); it.setLong(2, now); it.setString(3, id.toString())
            it.executeUpdate()
        }
        if (updated == 0) {
            c.prepareStatement("INSERT INTO ${t.players} (player_uuid, name, first_seen, last_seen, playtime_ms) VALUES (?, ?, ?, ?, 0)").use {
                it.setString(1, id.toString()); it.setString(2, name); it.setLong(3, firstSeen); it.setLong(4, now)
                it.executeUpdate()
            }
        }
    }

    /** Adds [ms] of play to [id] (a server counts its own share of the session) and marks them seen at [now]. */
    fun addPlaytime(id: UUID, ms: Long, now: Long) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE ${t.players} SET playtime_ms = playtime_ms + ?, last_seen = ? WHERE player_uuid = ?").use {
            it.setLong(1, ms.coerceAtLeast(0)); it.setLong(2, now); it.setString(3, id.toString())
            it.executeUpdate()
        }
    }
}
