package net.artisanmc.plugin.database

import java.sql.Timestamp
import java.time.Instant
import javax.sql.DataSource

/**
 * What a server loaded at its last start or reload, beyond its Versions: its Project list and,
 * per Project, the Snapshot hash and the files that failed to load. Opaque JSON, written whole.
 */
class ServerStateStore(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {
    fun put(server: ServerRow, state: String, now: Instant) = dataSource.connection.use { c ->
        val updated = c.prepareStatement("UPDATE ${t.serverState} SET state = ?, updated_at = ? WHERE server_id = ?").use {
            it.setString(1, state); it.setTimestamp(2, Timestamp.from(now)); it.setInt(3, server.value); it.executeUpdate()
        }
        if (updated == 0) c.prepareStatement("INSERT INTO ${t.serverState} (server_id, state, updated_at) VALUES (?, ?, ?)").use {
            it.setInt(1, server.value); it.setString(2, state); it.setTimestamp(3, Timestamp.from(now)); it.executeUpdate()
        }
    }

    fun get(server: ServerRow): String? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT state FROM ${t.serverState} WHERE server_id = ?").use { s ->
            s.setInt(1, server.value); s.executeQuery().use { if (it.next()) it.getString(1) else null }
        }
    }
}
