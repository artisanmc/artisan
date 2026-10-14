package net.artisanmc.plugin.database

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class EditorSessionRow(
    val playerId: UUID,
    val playerName: String,
    val permissions: Set<String>,
    val expiresAt: Instant,
    val origin: String = "",
)

/** Editor sign-ins kept by the hub across restarts, keyed by a hash of the session id. */
class EditorSessionRows(private val dataSource: DataSource) {
    fun put(key: String, row: EditorSessionRow) = dataSource.connection.use { c ->
        c.prepareStatement("INSERT INTO artisan_editor_sessions (id_hash, player_id, player_name, permissions, expires_at, origin) VALUES (?, ?, ?, ?, ?, ?)").use {
            it.setString(1, key); it.setString(2, row.playerId.toString()); it.setString(3, row.playerName)
            it.setString(4, encode(row.permissions)); it.setTimestamp(5, Timestamp.from(row.expiresAt)); it.setString(6, row.origin)
            it.executeUpdate()
        }
    }

    fun get(key: String): EditorSessionRow? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT player_id, player_name, permissions, expires_at, origin FROM artisan_editor_sessions WHERE id_hash = ?").use { s ->
            s.setString(1, key)
            s.executeQuery().use { rs ->
                if (!rs.next()) null
                else EditorSessionRow(
                    UUID.fromString(rs.getString(1)), rs.getString(2),
                    rs.getString(3).split(',').filter { it.isNotEmpty() }.toSet(), rs.getTimestamp(4).toInstant(), rs.getString(5),
                )
            }
        }
    }

    fun touch(key: String, expiresAt: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE artisan_editor_sessions SET expires_at = ? WHERE id_hash = ?").use {
            it.setTimestamp(1, Timestamp.from(expiresAt)); it.setString(2, key); it.executeUpdate()
        }
    }

    fun delete(key: String) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM artisan_editor_sessions WHERE id_hash = ?").use { it.setString(1, key); it.executeUpdate() }
    }

    fun purge(now: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM artisan_editor_sessions WHERE expires_at <= ?").use { it.setTimestamp(1, Timestamp.from(now)); it.executeUpdate() }
    }

    fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE artisan_editor_sessions SET permissions = ? WHERE player_id = ? AND origin = ?").use {
            it.setString(1, encode(permissions)); it.setString(2, playerId.toString()); it.setString(3, origin); it.executeUpdate()
        }
    }

    /** Every session of [playerId], or only those [origin] issued; the number deleted. */
    fun deletePlayer(playerId: UUID, origin: String?): Int = dataSource.connection.use { c ->
        val sql = "DELETE FROM artisan_editor_sessions WHERE player_id = ?" + if (origin != null) " AND origin = ?" else ""
        c.prepareStatement(sql).use {
            it.setString(1, playerId.toString()); if (origin != null) it.setString(2, origin); it.executeUpdate()
        }
    }

    private fun encode(permissions: Set<String>) = permissions.sorted().joinToString(",")
}
