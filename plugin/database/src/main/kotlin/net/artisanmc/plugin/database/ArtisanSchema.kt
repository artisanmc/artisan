package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.util.logging.Logger
import javax.sql.DataSource

/** Artisan's own tables in the suite database (ADR `server-identity-and-versions`). */
object ArtisanSchema {
    const val VERSION_TABLE = "artisan_schema_version"
    private fun hasColumn(c: java.sql.Connection, table: String, column: String) = SchemaMigrator.hasColumn(c, table, column)
    private fun hasIndex(c: java.sql.Connection, table: String, index: String) = SchemaMigrator.hasIndex(c, table, index)
    private fun hasForeignKey(c: java.sql.Connection, table: String, column: String) = SchemaMigrator.hasForeignKey(c, table, column)

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
        Migration(2, "ALTER TABLE artisan_servers ADD COLUMN running BOOLEAN NOT NULL DEFAULT FALSE") { hasColumn(it, "artisan_servers", "running") },
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
        Migration(6, "CREATE INDEX artisan_versions_project ON artisan_versions (server_id, project_key, id)") { hasIndex(it, "artisan_versions", "artisan_versions_project") },
        Migration(7, "CREATE INDEX artisan_versions_folder ON artisan_versions (server_id, folder, id)") { hasIndex(it, "artisan_versions", "artisan_versions_folder") },
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
        // The server id that issued the session: the one whose permission reads apply to it.
        Migration(12, "ALTER TABLE artisan_editor_sessions ADD COLUMN origin VARCHAR(64) NOT NULL DEFAULT ''") { hasColumn(it, "artisan_editor_sessions", "origin") },
        // Closed drafts and old receipts are purged by age (`DraftRows.purge`); rows from before carry no date and stay.
        Migration(13, "ALTER TABLE artisan_drafts ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'") { hasColumn(it, "artisan_drafts", "status") },
        Migration(14, "ALTER TABLE artisan_drafts ADD COLUMN updated_at TIMESTAMP NULL") { hasColumn(it, "artisan_drafts", "updated_at") },
        Migration(15, "ALTER TABLE artisan_draft_receipts ADD COLUMN created_at TIMESTAMP NULL") { hasColumn(it, "artisan_draft_receipts", "created_at") },
        // MySQL 8 ignores the inline `REFERENCES` of migration 5; H2 honoured it, so the step is only recorded there.
        Migration(16, "ALTER TABLE artisan_versions ADD CONSTRAINT artisan_versions_server FOREIGN KEY (server_id) REFERENCES artisan_servers(id)") {
            hasForeignKey(it, "artisan_versions", "server_id")
        },
    )

    fun migrate(dataSource: DataSource, dialect: DatabaseDialect, logger: Logger) =
        SchemaMigrator(dataSource, dialect, VERSION_TABLE, logger).apply(MIGRATIONS)
}
