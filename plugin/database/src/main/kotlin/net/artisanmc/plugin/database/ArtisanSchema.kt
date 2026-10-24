package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.util.logging.Logger
import javax.sql.DataSource

/** Artisan's own tables in the suite database (ADR `server-identity-and-versions`). */
object ArtisanSchema {
    private fun hasColumn(c: java.sql.Connection, table: String, column: String) = SchemaMigrator.hasColumn(c, table, column)
    private fun hasIndex(c: java.sql.Connection, table: String, index: String) = SchemaMigrator.hasIndex(c, table, index)
    private fun hasForeignKey(c: java.sql.Connection, table: String, column: String) = SchemaMigrator.hasForeignKey(c, table, column)

    fun migrations(t: ArtisanTables = ArtisanTables.DEFAULT) = listOf(
        Migration(
            1,
            """CREATE TABLE IF NOT EXISTS ${t.servers} (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                uuid CHAR(36) NOT NULL UNIQUE,
                name VARCHAR(64) NOT NULL UNIQUE,
                last_seen TIMESTAMP NOT NULL
            )""",
        ),
        // A server stopped cleanly is no longer running: renaming it right away is not a copy.
        Migration(2, "ALTER TABLE ${t.servers} ADD COLUMN running BOOLEAN NOT NULL DEFAULT FALSE") { hasColumn(it, t.servers, "running") },
        Migration(3, "CREATE TABLE IF NOT EXISTS ${t.meta} (name VARCHAR(64) NOT NULL PRIMARY KEY, val VARCHAR(255) NOT NULL)"),
        Migration(4, "CREATE TABLE IF NOT EXISTS ${t.contents} (hash VARCHAR(64) NOT NULL PRIMARY KEY, content LONGBLOB NOT NULL)"),
        Migration(
            5,
            """CREATE TABLE IF NOT EXISTS ${t.versions} (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                server_id INT NOT NULL REFERENCES ${t.servers}(id),
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
        Migration(6, "CREATE INDEX ${t.versionsProjectIndex} ON ${t.versions} (server_id, project_key, id)") { hasIndex(it, t.versions, t.versionsProjectIndex) },
        Migration(7, "CREATE INDEX ${t.versionsFolderIndex} ON ${t.versions} (server_id, folder, id)") { hasIndex(it, t.versions, t.versionsFolderIndex) },
        Migration(
            8,
            "CREATE TABLE IF NOT EXISTS ${t.serverState} (server_id INT NOT NULL PRIMARY KEY, state LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL)",
        ),
        Migration(
            9,
            """CREATE TABLE IF NOT EXISTS ${t.drafts} (
                server_id INT NOT NULL,
                project_key VARCHAR(80) NOT NULL,
                id VARCHAR(128) NOT NULL,
                draft LONGTEXT NOT NULL,
                PRIMARY KEY (server_id, project_key, id)
            )""",
        ),
        Migration(
            10,
            "CREATE TABLE IF NOT EXISTS ${t.draftReceipts} (operation_id VARCHAR(256) NOT NULL PRIMARY KEY, fingerprint VARCHAR(64) NOT NULL, result LONGTEXT NOT NULL)",
        ),
        Migration(
            11,
            """CREATE TABLE IF NOT EXISTS ${t.editorSessions} (
                id_hash CHAR(64) NOT NULL PRIMARY KEY,
                player_id CHAR(36) NOT NULL,
                player_name VARCHAR(32) NOT NULL,
                permissions VARCHAR(255) NOT NULL,
                expires_at TIMESTAMP NOT NULL
            )""",
        ),
        // The server id that issued the session: the one whose permission reads apply to it.
        Migration(12, "ALTER TABLE ${t.editorSessions} ADD COLUMN origin VARCHAR(64) NOT NULL DEFAULT ''") { hasColumn(it, t.editorSessions, "origin") },
        // Closed drafts and old receipts are purged by age (`DraftRows.purge`); rows from before carry no date and stay.
        Migration(13, "ALTER TABLE ${t.drafts} ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'") { hasColumn(it, t.drafts, "status") },
        Migration(14, "ALTER TABLE ${t.drafts} ADD COLUMN updated_at TIMESTAMP NULL") { hasColumn(it, t.drafts, "updated_at") },
        Migration(15, "ALTER TABLE ${t.draftReceipts} ADD COLUMN created_at TIMESTAMP NULL") { hasColumn(it, t.draftReceipts, "created_at") },
        // MySQL 8 ignores the inline `REFERENCES` of migration 5; H2 honoured it, so the step is only recorded there.
        Migration(16, "ALTER TABLE ${t.versions} ADD CONSTRAINT ${t.versionsServerKey} FOREIGN KEY (server_id) REFERENCES ${t.servers}(id)") {
            hasForeignKey(it, t.versions, "server_id")
        },
        // Where the other servers reach this one's `/ws/plugin` (ADR `peer-servers`): its public editor address, its internal one.
        Migration(17, "ALTER TABLE ${t.servers} ADD COLUMN editor_url VARCHAR(255) NOT NULL DEFAULT ''") { hasColumn(it, t.servers, "editor_url") },
        Migration(18, "ALTER TABLE ${t.servers} ADD COLUMN internal_url VARCHAR(255) NOT NULL DEFAULT ''") { hasColumn(it, t.servers, "internal_url") },
        // The owner's UUID, so a listing reads one player's active drafts, not every draft of the Project (`DraftRows.active`).
        // Rows from before carry '' until their next commit: a listing still reads those and filters them by their body.
        Migration(19, "ALTER TABLE ${t.drafts} ADD COLUMN owner VARCHAR(64) NOT NULL DEFAULT ''") { hasColumn(it, t.drafts, "owner") },
        // Cooldowns of actions and commands (`CooldownRows`): kept across restarts, shared by the servers of a network.
        // `subject` is a player's UUID, or `*` for a server-wide cooldown; `expires_at` in epoch milliseconds.
        Migration(
            20,
            """CREATE TABLE IF NOT EXISTS ${t.cooldowns} (
                cooldown_id VARCHAR(128) NOT NULL,
                subject VARCHAR(36) NOT NULL,
                expires_at BIGINT NOT NULL,
                PRIMARY KEY (cooldown_id, subject)
            )""",
        ),
        Migration(21, "CREATE INDEX ${t.cooldownsSubjectIndex} ON ${t.cooldowns} (subject)") { hasIndex(it, t.cooldowns, t.cooldownsSubjectIndex) },
        // `api.network` (design `reseau-artisan`): the messages between servers, read by id, kept a minute.
        Migration(
            22,
            """CREATE TABLE IF NOT EXISTS ${t.networkMessages} (
                id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                created_at TIMESTAMP NOT NULL,
                server_from VARCHAR(64) NOT NULL,
                channel VARCHAR(128) NOT NULL,
                payload LONGTEXT NOT NULL
            )""",
        ),
        Migration(23, "CREATE INDEX ${t.networkMessagesTimeIndex} ON ${t.networkMessages} (created_at)") { hasIndex(it, t.networkMessages, t.networkMessagesTimeIndex) },
        // The players online on each server, rewritten by each server: what `api.network.presence` reads.
        Migration(
            24,
            """CREATE TABLE IF NOT EXISTS ${t.networkPlayers} (
                player_uuid CHAR(36) NOT NULL PRIMARY KEY,
                name VARCHAR(16) NOT NULL,
                server_name VARCHAR(64) NOT NULL,
                updated_at TIMESTAMP NOT NULL
            )""",
        ),
    )

    fun migrate(dataSource: DataSource, dialect: DatabaseDialect, logger: Logger, t: ArtisanTables = ArtisanTables.DEFAULT) =
        SchemaMigrator(dataSource, dialect, t.schemaVersion, logger).apply(migrations(t))
}
