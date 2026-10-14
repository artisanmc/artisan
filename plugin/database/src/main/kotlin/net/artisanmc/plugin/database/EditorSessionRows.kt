package net.artisanmc.plugin.database

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class EditorSessionRow(val playerId: UUID, val playerName: String, val permissions: Set<String>, val expiresAt: Instant)

/** Editor sign-ins kept by the hub across restarts, keyed by a hash of the session id. */
class EditorSessionRows(private val dataSource: DataSource) {
    fun put(key: String, row: EditorSessionRow) = dataSource.connection.use { c ->
        c.prepareStatement("INSERT INTO artisan_editor_sessions (id_hash, player_id, player_name, permissions, expires_at) VALUES (?, ?, ?, ?, ?)").use {
            it.setString(1, key); it.setString(2, row.playerId.toString()); it.setString(3, row.playerName)
            it.setString(4, row.permissions.sorted().joinToString(",")); it.setTimestamp(5, Timestamp.from(row.expiresAt))
            it.executeUpdate()
        }
    }

    fun get(key: String): EditorSessionRow? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT player_id, player_name, permissions, expires_at FROM artisan_editor_sessions WHERE id_hash = ?").use { s ->
            s.setString(1, key)
            s.executeQuery().use { rs ->
                if (!rs.next()) null
                else EditorSessionRow(
                    UUID.fromString(rs.getString(1)), rs.getString(2),
                    rs.getString(3).split(',').filter { it.isNotEmpty() }.toSet(), rs.getTimestamp(4).toInstant(),
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
}
