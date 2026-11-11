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
