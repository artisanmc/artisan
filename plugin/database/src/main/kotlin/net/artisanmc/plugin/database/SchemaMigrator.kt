package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.sql.Connection
import java.sql.SQLException
import java.util.logging.Logger
import javax.sql.DataSource

/**
 * One forward-only schema step. MySQL commits DDL on its own: a crash between the statement and
 * the version update leaves the step applied but unrecorded, so a step that cannot be re-run
 * (`ADD COLUMN`, `CREATE INDEX`, `ADD CONSTRAINT`) says with [applied] when it already is.
 */
class Migration(val version: Int, val sql: String, val applied: ((Connection) -> Boolean)? = null)

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
    fun version(): Int = locked { c -> prepare(c); read(c) }

    fun apply(migrations: List<Migration>) = locked { c ->
        prepare(c)
        val current = read(c)
        migrations.sortedBy { it.version }.filter { it.version > current }.forEach { step(c, it) }
    }

    /** [block] under the schema lock on MySQL/MariaDB; a lock not granted within 30 s is an error, not a go. */
    private fun <T> locked(block: (Connection) -> T): T = dataSource.connection.use { c ->
        val locked = dialect != DatabaseDialect.H2
        if (locked) {
            val granted = c.prepareStatement("SELECT GET_LOCK(?, 30)").use { s ->
                s.setString(1, table); s.executeQuery().use { it.next() && it.getInt(1) == 1 }
            }
            if (!granted) throw IllegalStateException("Schema lock '$table' not granted: another server is migrating, or the lock failed")
        }
        try {
            block(c)
        } finally {
            if (locked) c.prepareStatement("SELECT RELEASE_LOCK(?)").use { it.setString(1, table); it.executeQuery().close() }
        }
    }

    private fun step(c: Connection, migration: Migration) {
        val already = migration.applied?.invoke(c) == true
        c.autoCommit = false
        try {
            if (!already) c.createStatement().use { it.execute(migration.sql) }
            c.prepareStatement("UPDATE $table SET version = ?").use { it.setInt(1, migration.version); it.executeUpdate() }
            c.commit()
        } catch (e: SQLException) {
            c.rollback()
            throw IllegalStateException("Migration ${migration.version} of $table failed: ${e.message}", e)
        } finally {
            c.autoCommit = true
        }
        logger.info("[database] $table: migration ${migration.version} ${if (already) "already applied, recorded" else "applied"}")
    }

    private fun prepare(c: Connection) {
        c.createStatement().use { it.execute("CREATE TABLE IF NOT EXISTS $table (version INT NOT NULL)") }
        val empty = c.createStatement().use { s -> s.executeQuery("SELECT COUNT(*) FROM $table").use { it.next(); it.getInt(1) == 0 } }
        if (empty) c.createStatement().use { it.executeUpdate("INSERT INTO $table (version) VALUES (0)") }
    }

    private fun read(c: Connection): Int =
        c.createStatement().use { s -> s.executeQuery("SELECT version FROM $table").use { it.next(); it.getInt(1) } }

    /** Catalog reads for [Migration.applied]; names are tried as given and upper-cased (H2 folds unquoted identifiers). */
    companion object {
        private fun forms(name: String) = listOf(name, name.uppercase()).distinct()

        fun hasTable(c: Connection, table: String): Boolean =
            forms(table).any { t -> c.metaData.getTables(null, null, t, null).use { it.next() } }

        fun hasColumn(c: Connection, table: String, column: String): Boolean =
            forms(table).any { t -> forms(column).any { col -> c.metaData.getColumns(null, null, t, col).use { it.next() } } }

        fun hasIndex(c: Connection, table: String, index: String): Boolean = forms(table).any { t ->
            c.metaData.getIndexInfo(null, null, t, false, true).use { rs ->
                generateSequence { if (rs.next()) rs.getString("INDEX_NAME") else null }.any { it.equals(index, ignoreCase = true) }
            }
        }

        /** A foreign key from [table].[column], whatever its name. */
        fun hasForeignKey(c: Connection, table: String, column: String): Boolean = forms(table).any { t ->
            c.metaData.getImportedKeys(null, null, t).use { rs ->
                generateSequence { if (rs.next()) rs.getString("FKCOLUMN_NAME") else null }.any { it.equals(column, ignoreCase = true) }
            }
        }
    }
}
