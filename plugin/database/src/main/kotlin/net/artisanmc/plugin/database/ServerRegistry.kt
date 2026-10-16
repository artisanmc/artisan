package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import javax.sql.DataSource

data class KnownServer(val name: String, val lastSeen: Instant, val uuid: String = "")

sealed interface Registration {
    data object Registered : Registration
    data object Updated : Registration
    data class Renamed(val from: String) : Registration
    /** The same server id runs elsewhere under [running]: this server is a copy. */
    data class CopiedId(val running: String) : Registration
    /** Another server id holds this name. */
    data object NameTaken : Registration
}

private val COPY_WINDOW = java.time.Duration.ofMinutes(2)

/** `artisan_servers`: every server of the Network, online or not, by its server id. */
class ServerRegistry(
    private val dataSource: DataSource,
    @Suppress("unused") private val dialect: DatabaseDialect,
    private val logger: Logger,
) {
    private class Row(val uuid: String, val name: String, val lastSeen: Instant, val running: Boolean)

    /**
     * Claims [name] for this server id. The row of a renamed server follows it; a server id already
     * running under another name, or a name held by another server id, is refused.
     */
    fun register(id: UUID, name: String, now: Instant): Registration = dataSource.connection.use { c ->
        val mine = row(c, "uuid = ?", id.toString())
        val holder = row(c, "LOWER(name) = LOWER(?)", name)
        when {
            holder != null && holder.uuid != id.toString() -> Registration.NameTaken
            mine == null -> {
                c.prepareStatement("INSERT INTO artisan_servers (uuid, name, last_seen, running) VALUES (?, ?, ?, TRUE)").use {
                    it.setString(1, id.toString()); it.setString(2, name); it.setTimestamp(3, Timestamp.from(now)); it.executeUpdate()
                }
                logger.info("[Artisan] Server $name registered ($id)")
                Registration.Registered
            }
            mine.name != name && mine.running && mine.lastSeen.isAfter(now.minus(COPY_WINDOW)) -> Registration.CopiedId(mine.name)
            else -> {
                c.prepareStatement("UPDATE artisan_servers SET name = ?, last_seen = ?, running = TRUE WHERE uuid = ?").use {
                    it.setString(1, name); it.setTimestamp(2, Timestamp.from(now)); it.setString(3, id.toString()); it.executeUpdate()
                }
                if (mine.name == name) Registration.Updated
                else Registration.Renamed(mine.name).also { logger.info("[Artisan] Server renamed ${mine.name} -> $name ($id)") }
            }
        }
    }

    /** The `artisan_servers.id` of a server id, or of a server name. */
    fun rowId(id: UUID): Int? = dataSource.connection.use { c -> rowId(c, "uuid = ?", id.toString()) }
    fun rowId(name: String): Int? = dataSource.connection.use { c -> rowId(c, "LOWER(name) = LOWER(?)", name) }

    private fun rowId(c: java.sql.Connection, where: String, value: String): Int? =
        c.prepareStatement("SELECT id FROM artisan_servers WHERE $where").use { s ->
            s.setString(1, value); s.executeQuery().use { if (it.next()) it.getInt(1) else null }
        }

    /** A clean stop: the server id may come back under another name at once. */
    fun stop(id: UUID) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE artisan_servers SET running = FALSE WHERE uuid = ?").use { it.setString(1, id.toString()); it.executeUpdate() }
    }

    private fun row(c: java.sql.Connection, where: String, value: String): Row? =
        c.prepareStatement("SELECT uuid, name, last_seen, running FROM artisan_servers WHERE $where").use { s ->
            s.setString(1, value)
            s.executeQuery().use { rs -> if (rs.next()) Row(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant(), rs.getBoolean(4)) else null }
        }

    fun touch(id: UUID, now: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE artisan_servers SET last_seen = ? WHERE uuid = ?").use {
            it.setTimestamp(1, Timestamp.from(now)); it.setString(2, id.toString()); it.executeUpdate()
        }
    }

    /** Every server but [self], by name. */
    fun others(self: UUID): List<KnownServer> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT name, last_seen, uuid FROM artisan_servers WHERE uuid <> ? ORDER BY name").use { s ->
            s.setString(1, self.toString())
            s.executeQuery().use { rs ->
                generateSequence { if (rs.next()) KnownServer(rs.getString(1), rs.getTimestamp(2).toInstant(), rs.getString(3)) else null }.toList()
            }
        }
    }
}
