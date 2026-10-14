package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.io.File
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import javax.sql.DataSource

/** Artisan's own tables in the suite database (ADR `server-identity-and-versions`). */
object ArtisanSchema {
    const val VERSION_TABLE = "artisan_schema_version"

    val MIGRATIONS = listOf(
        Migration(
            1,
            """CREATE TABLE IF NOT EXISTS artisan_servers (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                uuid CHAR(36) NOT NULL UNIQUE,
                name VARCHAR(64) NOT NULL UNIQUE,
                last_seen TIMESTAMP NOT NULL
            )""",
        ),
    )

    fun migrate(dataSource: DataSource, dialect: DatabaseDialect, logger: Logger) =
        SchemaMigrator(dataSource, dialect, VERSION_TABLE, logger).apply(MIGRATIONS)
}

/** The server's identity: a UUID written once in `plugins/Artisan/server-id`, kept across renames. */
object ServerIdFile {
    fun read(file: File): UUID {
        file.takeIf { it.isFile }?.readText()?.trim()?.let { text -> runCatching { UUID.fromString(text) }.getOrNull() }?.let { return it }
        return UUID.randomUUID().also {
            file.parentFile?.mkdirs()
            file.writeText("$it\n")
        }
    }
}

data class KnownServer(val name: String, val lastSeen: Instant)

/** `artisan_servers`: every server of the Network, online or not, by its server id. */
class ServerRegistry(
    private val dataSource: DataSource,
    @Suppress("unused") private val dialect: DatabaseDialect,
    private val logger: Logger,
) {
    fun register(id: UUID, name: String, now: Instant) = dataSource.connection.use { c ->
        val updated = c.prepareStatement("UPDATE artisan_servers SET name = ?, last_seen = ? WHERE uuid = ?").use {
            it.setString(1, name); it.setTimestamp(2, Timestamp.from(now)); it.setString(3, id.toString()); it.executeUpdate()
        }
        if (updated == 0) c.prepareStatement("INSERT INTO artisan_servers (uuid, name, last_seen) VALUES (?, ?, ?)").use {
            it.setString(1, id.toString()); it.setString(2, name); it.setTimestamp(3, Timestamp.from(now)); it.executeUpdate()
            logger.info("[Artisan] Server $name registered ($id)")
        }
    }

    fun touch(id: UUID, now: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE artisan_servers SET last_seen = ? WHERE uuid = ?").use {
            it.setTimestamp(1, Timestamp.from(now)); it.setString(2, id.toString()); it.executeUpdate()
        }
    }

    /** Every server but [self], by name. */
    fun others(self: UUID): List<KnownServer> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT name, last_seen FROM artisan_servers WHERE uuid <> ? ORDER BY name").use { s ->
            s.setString(1, self.toString())
            s.executeQuery().use { rs ->
                generateSequence { if (rs.next()) KnownServer(rs.getString(1), rs.getTimestamp(2).toInstant()) else null }.toList()
            }
        }
    }
}
