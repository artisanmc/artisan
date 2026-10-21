package net.artisanmc.plugin.database

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/** A message between servers, as `artisan_network_messages` holds it. */
data class NetworkMessageRow(val id: Long, val serverFrom: String, val channel: String, val payload: String)

/** A player online on a server, as `artisan_network_players` holds it. */
data class NetworkPlayerRow(val id: UUID, val name: String, val server: String)

/**
 * The tables behind `api.network` (design `reseau-artisan`): messages read by id by every server
 * and purged after a minute, and the players each server says are online. Plain JDBC that H2,
 * MySQL and MariaDB run the same. Every method blocks: call them off the game threads.
 */
class NetworkRows(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {

    fun publish(serverFrom: String, channel: String, payload: String, now: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("INSERT INTO ${t.networkMessages} (created_at, server_from, channel, payload) VALUES (?, ?, ?, ?)").use {
            it.setTimestamp(1, Timestamp.from(now))
            it.setString(2, serverFrom)
            it.setString(3, channel)
            it.setString(4, payload)
            it.executeUpdate()
        }
    }

    /** The highest id written so far: a server starts reading after it, never replaying what came before. */
    fun lastId(): Long = dataSource.connection.use { c ->
        c.createStatement().use { s -> s.executeQuery("SELECT MAX(id) FROM ${t.networkMessages}").use { if (it.next()) it.getLong(1) else 0L } }
    }

    /** The messages after [afterId], in order, at most [limit]. */
    fun after(afterId: Long, limit: Int = 500): List<NetworkMessageRow> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT id, server_from, channel, payload FROM ${t.networkMessages} WHERE id > ? ORDER BY id").use { s ->
            s.maxRows = limit
            s.setLong(1, afterId)
            s.executeQuery().use { r ->
                buildList {
                    while (r.next()) add(NetworkMessageRow(r.getLong(1), r.getString(2), r.getString(3), r.getString(4)))
                }
            }
        }
    }

    /** Drops the messages written before [before]; returns how many. */
    fun purge(before: Instant): Int = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.networkMessages} WHERE created_at < ?").use {
            it.setTimestamp(1, Timestamp.from(before))
            it.executeUpdate()
        }
    }

    /** A player joined [server] (or is still there): the row follows them from server to server. */
    fun join(player: NetworkPlayerRow, now: Instant) = dataSource.connection.use { c ->
        val updated = c.prepareStatement("UPDATE ${t.networkPlayers} SET name = ?, server_name = ?, updated_at = ? WHERE player_uuid = ?").use {
            it.setString(1, player.name); it.setString(2, player.server); it.setTimestamp(3, Timestamp.from(now)); it.setString(4, player.id.toString())
            it.executeUpdate()
        }
        if (updated == 0) {
            c.prepareStatement("INSERT INTO ${t.networkPlayers} (player_uuid, name, server_name, updated_at) VALUES (?, ?, ?, ?)").use {
                it.setString(1, player.id.toString()); it.setString(2, player.name); it.setString(3, player.server); it.setTimestamp(4, Timestamp.from(now))
                it.executeUpdate()
            }
        }
    }

    /** A player left [server]; a row already moved to another server by a faster join stays. */
    fun quit(id: UUID, server: String) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.networkPlayers} WHERE player_uuid = ? AND server_name = ?").use {
            it.setString(1, id.toString()); it.setString(2, server); it.executeUpdate()
        }
    }

    /**
     * [server]'s players are exactly [online]: rows of players gone are removed, the others
     * written again. Repairs what a crash or a lost quit left behind.
     */
    fun replace(server: String, online: Collection<NetworkPlayerRow>, now: Instant) {
        val keep = online.map { it.id.toString() }.toSet()
        dataSource.connection.use { c ->
            val stale = c.prepareStatement("SELECT player_uuid FROM ${t.networkPlayers} WHERE server_name = ?").use { s ->
                s.setString(1, server)
                s.executeQuery().use { r -> buildList { while (r.next()) r.getString(1).takeIf { it !in keep }?.let(::add) } }
            }
            c.prepareStatement("DELETE FROM ${t.networkPlayers} WHERE player_uuid = ? AND server_name = ?").use { s ->
                stale.forEach { s.setString(1, it); s.setString(2, server); s.addBatch() }
                if (stale.isNotEmpty()) s.executeBatch()
            }
        }
        online.forEach { join(it, now) }
    }

    /**
     * The players of the servers still running and seen since [since] (`artisan_servers`): a
     * server that stopped or crashed takes its players with it.
     */
    fun online(since: Instant): List<NetworkPlayerRow> = dataSource.connection.use { c ->
        c.prepareStatement(
            "SELECT p.player_uuid, p.name, p.server_name FROM ${t.networkPlayers} p " +
                "JOIN ${t.servers} s ON LOWER(s.name) = LOWER(p.server_name) WHERE s.running = TRUE AND s.last_seen >= ?",
        ).use { s ->
            s.setTimestamp(1, Timestamp.from(since))
            s.executeQuery().use { r ->
                buildList {
                    while (r.next()) {
                        val id = runCatching { UUID.fromString(r.getString(1)) }.getOrNull() ?: continue
                        add(NetworkPlayerRow(id, r.getString(2), r.getString(3)))
                    }
                }
            }
        }
    }

    /** The names of the servers running and seen since [since]. */
    fun servers(since: Instant): List<String> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT name FROM ${t.servers} WHERE running = TRUE AND last_seen >= ? ORDER BY name").use { s ->
            s.setTimestamp(1, Timestamp.from(since))
            s.executeQuery().use { r -> buildList { while (r.next()) add(r.getString(1)) } }
        }
    }
}
