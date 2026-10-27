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
    val createdAt: Instant? = null,
    /** A sign-in link not yet redeemed, stored so another server of the database can redeem it. */
    val link: Boolean = false,
)

/** Editor sign-ins kept by the hub across restarts, keyed by a hash of the session id. */
class EditorSessionRows(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {
    fun put(key: String, row: EditorSessionRow) = dataSource.connection.use { c ->
        c.prepareStatement("INSERT INTO ${t.editorSessions} (id_hash, player_id, player_name, permissions, expires_at, origin, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").use {
            it.setString(1, key); it.setString(2, row.playerId.toString()); it.setString(3, row.playerName)
            it.setString(4, encode(row.permissions)); it.setTimestamp(5, Timestamp.from(row.expiresAt)); it.setString(6, row.origin)
            it.setTimestamp(7, row.createdAt?.let(Timestamp::from)); it.setString(8, if (row.link) LINK else SESSION)
            it.executeUpdate()
        }
    }

    fun get(key: String): EditorSessionRow? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT $COLUMNS FROM ${t.editorSessions} WHERE id_hash = ?").use { s ->
            s.setString(1, key)
            s.executeQuery().use { rs -> if (!rs.next()) null else row(rs) }
        }
    }

    /** The sessions open at [now], by key, without the links stored next to them. */
    fun list(now: Instant): List<Pair<String, EditorSessionRow>> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT id_hash, $COLUMNS FROM ${t.editorSessions} WHERE expires_at > ? AND kind <> ?").use { s ->
            s.setTimestamp(1, Timestamp.from(now)); s.setString(2, LINK)
            s.executeQuery().use { rs ->
                // CHAR pads: H2 hands a short key back with trailing spaces.
                buildList { while (rs.next()) add(rs.getString(1).trimEnd() to row(rs, 1)) }
            }
        }
    }

    private fun row(rs: java.sql.ResultSet, offset: Int = 0) = EditorSessionRow(
        UUID.fromString(rs.getString(offset + 1)), rs.getString(offset + 2),
        rs.getString(offset + 3).split(',').filter { it.isNotEmpty() }.toSet(), rs.getTimestamp(offset + 4).toInstant(), rs.getString(offset + 5),
        rs.getTimestamp(offset + 6)?.toInstant(), rs.getString(offset + 7) == LINK,
    )

    fun touch(key: String, expiresAt: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE ${t.editorSessions} SET expires_at = ? WHERE id_hash = ?").use {
            it.setTimestamp(1, Timestamp.from(expiresAt)); it.setString(2, key); it.executeUpdate()
        }
    }

    fun delete(key: String) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.editorSessions} WHERE id_hash = ?").use { it.setString(1, key); it.executeUpdate() }
    }

    fun purge(now: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.editorSessions} WHERE expires_at <= ?").use { it.setTimestamp(1, Timestamp.from(now)); it.executeUpdate() }
    }

    fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE ${t.editorSessions} SET permissions = ? WHERE player_id = ? AND origin = ?").use {
            it.setString(1, encode(permissions)); it.setString(2, playerId.toString()); it.setString(3, origin); it.executeUpdate()
        }
    }

    /** Every session of [playerId], or only those [origin] issued; the number deleted. */
    fun deletePlayer(playerId: UUID, origin: String?): Int = dataSource.connection.use { c ->
        val sql = "DELETE FROM ${t.editorSessions} WHERE player_id = ?" + if (origin != null) " AND origin = ?" else ""
        c.prepareStatement(sql).use {
            it.setString(1, playerId.toString()); if (origin != null) it.setString(2, origin); it.executeUpdate()
        }
    }

    private fun encode(permissions: Set<String>) = permissions.sorted().joinToString(",")

    private companion object {
        const val COLUMNS = "player_id, player_name, permissions, expires_at, origin, created_at, kind"
        const val SESSION = "session"
        const val LINK = "link"
    }
}
