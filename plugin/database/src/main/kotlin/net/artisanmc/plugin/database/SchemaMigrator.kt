package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.sql.Connection
import java.sql.SQLException
import java.util.logging.Logger
import javax.sql.DataSource

/** One forward-only schema step. MySQL commits DDL on its own: one idempotent statement per step. */
class Migration(val version: Int, val sql: String)

/**
 * Applies the [Migration]s above the version kept in [table], in order, each with its version
 * update in one transaction. On MySQL/MariaDB a named lock keeps servers starting together from
 * applying the same step twice.
 */
class SchemaMigrator(
    private val dataSource: DataSource,
    private val dialect: DatabaseDialect,
    private val table: String,
    private val logger: Logger,
) {
    fun version(): Int = dataSource.connection.use { c -> prepare(c); read(c) }

    fun apply(migrations: List<Migration>) = dataSource.connection.use { c ->
        val locked = dialect != DatabaseDialect.H2
        if (locked) c.prepareStatement("SELECT GET_LOCK(?, 30)").use { it.setString(1, table); it.executeQuery().close() }
        try {
            prepare(c)
            val current = read(c)
            migrations.sortedBy { it.version }.filter { it.version > current }.forEach { step(c, it) }
        } finally {
            if (locked) c.prepareStatement("SELECT RELEASE_LOCK(?)").use { it.setString(1, table); it.executeQuery().close() }
        }
    }

    private fun step(c: Connection, migration: Migration) {
        c.autoCommit = false
        try {
            c.createStatement().use { it.execute(migration.sql) }
            c.prepareStatement("UPDATE $table SET version = ?").use { it.setInt(1, migration.version); it.executeUpdate() }
            c.commit()
        } catch (e: SQLException) {
            c.rollback()
            throw IllegalStateException("Migration ${migration.version} of $table failed: ${e.message}", e)
        } finally {
            c.autoCommit = true
        }
        logger.info("[database] $table: migration ${migration.version} applied")
    }

    private fun prepare(c: Connection) {
        c.createStatement().use { it.execute("CREATE TABLE IF NOT EXISTS $table (version INT NOT NULL)") }
        val empty = c.createStatement().use { s -> s.executeQuery("SELECT COUNT(*) FROM $table").use { it.next(); it.getInt(1) == 0 } }
        if (empty) c.createStatement().use { it.executeUpdate("INSERT INTO $table (version) VALUES (0)") }
    }

    private fun read(c: Connection): Int =
        c.createStatement().use { s -> s.executeQuery("SELECT version FROM $table").use { it.next(); it.getInt(1) } }
}
