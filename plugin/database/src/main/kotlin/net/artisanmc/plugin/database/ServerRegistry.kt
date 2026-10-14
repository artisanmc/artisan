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
        // A server stopped cleanly is no longer running: renaming it right away is not a copy.
        Migration(2, "ALTER TABLE artisan_servers ADD COLUMN running BOOLEAN NOT NULL DEFAULT FALSE"),
        Migration(3, "CREATE TABLE IF NOT EXISTS artisan_meta (name VARCHAR(64) NOT NULL PRIMARY KEY, val VARCHAR(255) NOT NULL)"),
        Migration(4, "CREATE TABLE IF NOT EXISTS artisan_contents (hash VARCHAR(64) NOT NULL PRIMARY KEY, content LONGBLOB NOT NULL)"),
        Migration(
            5,
            """CREATE TABLE IF NOT EXISTS artisan_versions (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                server_id INT NOT NULL REFERENCES artisan_servers(id),
                project_key VARCHAR(80) NOT NULL,
                folder VARCHAR(128) NOT NULL,
                hash VARCHAR(64) NOT NULL,
                manifest LONGTEXT NOT NULL,
                author_id CHAR(36),
                author_name VARCHAR(32),
                created_at TIMESTAMP NOT NULL,
                restored_from INT
            )""",
        ),
        Migration(6, "CREATE INDEX artisan_versions_project ON artisan_versions (server_id, project_key, id)"),
        Migration(7, "CREATE INDEX artisan_versions_folder ON artisan_versions (server_id, folder, id)"),
        Migration(
            8,
            "CREATE TABLE IF NOT EXISTS artisan_server_state (server_id INT NOT NULL PRIMARY KEY, state LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL)",
        ),
        Migration(
            9,
            """CREATE TABLE IF NOT EXISTS artisan_drafts (
                server_id INT NOT NULL,
                project_key VARCHAR(80) NOT NULL,
                id VARCHAR(128) NOT NULL,
                draft LONGTEXT NOT NULL,
                PRIMARY KEY (server_id, project_key, id)
            )""",
        ),
        Migration(
            10,
            "CREATE TABLE IF NOT EXISTS artisan_draft_receipts (operation_id VARCHAR(256) NOT NULL PRIMARY KEY, fingerprint VARCHAR(64) NOT NULL, result LONGTEXT NOT NULL)",
        ),
        Migration(
            11,
            """CREATE TABLE IF NOT EXISTS artisan_editor_sessions (
                id_hash CHAR(64) NOT NULL PRIMARY KEY,
                player_id CHAR(36) NOT NULL,
                player_name VARCHAR(32) NOT NULL,
                permissions VARCHAR(255) NOT NULL,
                expires_at TIMESTAMP NOT NULL
            )""",
        ),
    )

    fun migrate(dataSource: DataSource, dialect: DatabaseDialect, logger: Logger) =
        SchemaMigrator(dataSource, dialect, VERSION_TABLE, logger).apply(MIGRATIONS)
}

/** Facts about the suite database itself. */
object ArtisanMeta {
    /** Generated once per database: servers of one Network must all announce the same. */
    fun databaseId(dataSource: DataSource): String = dataSource.connection.use { c ->
        fun read() = c.prepareStatement("SELECT val FROM artisan_meta WHERE name = 'database_id'").use { s ->
            s.executeQuery().use { if (it.next()) it.getString(1) else null }
        }
        read() ?: runCatching {
            c.prepareStatement("INSERT INTO artisan_meta (name, val) VALUES ('database_id', ?)").use {
                it.setString(1, UUID.randomUUID().toString()); it.executeUpdate()
            }
        }.let { read() ?: throw IllegalStateException("artisan_meta: no database_id", it.exceptionOrNull()) }
    }
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

/**
 * What a server loaded at its last start or reload, beyond its Versions: its Project list and,
 * per Project, the Snapshot hash and the files that failed to load. Opaque JSON, written whole.
 */
class ServerStateStore(private val dataSource: DataSource) {
    fun put(server: Int, state: String, now: Instant) = dataSource.connection.use { c ->
        val updated = c.prepareStatement("UPDATE artisan_server_state SET state = ?, updated_at = ? WHERE server_id = ?").use {
            it.setString(1, state); it.setTimestamp(2, Timestamp.from(now)); it.setInt(3, server); it.executeUpdate()
        }
        if (updated == 0) c.prepareStatement("INSERT INTO artisan_server_state (server_id, state, updated_at) VALUES (?, ?, ?)").use {
            it.setInt(1, server); it.setString(2, state); it.setTimestamp(3, Timestamp.from(now)); it.executeUpdate()
        }
    }

    fun get(server: Int): String? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT state FROM artisan_server_state WHERE server_id = ?").use { s ->
            s.setInt(1, server); s.executeQuery().use { if (it.next()) it.getString(1) else null }
        }
    }
}
