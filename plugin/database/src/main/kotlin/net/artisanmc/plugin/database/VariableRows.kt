package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import javax.sql.DataSource

/**
 * `artisan_vars` (ADR `triggers-and-variables` §5): one row per Project variable and owner (a
 * player's UUID, or `*` for a server-wide value), its JSON value (NULL once cleared), expiry and
 * last write in epoch milliseconds. Written as values change, read when a player joins and every
 * few seconds for the server-wide ones; expired and cleared rows purged once a day.
 */
class VariableRows(
    private val dataSource: DataSource,
    private val dialect: DatabaseDialect = DatabaseDialect.H2,
    private val t: ArtisanTables = ArtisanTables.DEFAULT,
) {
    data class Row(val owner: String, val name: String, val value: String?, val expiresAt: Long, val updatedAt: Long)

    /** Writes [row] unless the stored one is newer: two servers writing at once keep the later write. */
    fun put(row: Row) = dataSource.connection.use { c ->
        val sql = when (dialect) {
            DatabaseDialect.H2 ->
                "MERGE INTO ${t.vars} t USING (VALUES (CAST(? AS VARCHAR(36)), CAST(? AS VARCHAR(200)), CAST(? AS CLOB), CAST(? AS BIGINT), CAST(? AS BIGINT))) " +
                    "s(owner, name, val, expires_at, updated_at) ON t.owner = s.owner AND t.name = s.name " +
                    "WHEN MATCHED AND t.updated_at <= s.updated_at THEN UPDATE SET val = s.val, expires_at = s.expires_at, updated_at = s.updated_at " +
                    "WHEN NOT MATCHED THEN INSERT (owner, name, val, expires_at, updated_at) VALUES (s.owner, s.name, s.val, s.expires_at, s.updated_at)"
            DatabaseDialect.MYSQL, DatabaseDialect.MARIADB ->
                "INSERT INTO ${t.vars} (owner, name, val, expires_at, updated_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE " +
                    "val = IF(updated_at <= VALUES(updated_at), VALUES(val), val), " +
                    "expires_at = IF(updated_at <= VALUES(updated_at), VALUES(expires_at), expires_at), " +
                    "updated_at = GREATEST(updated_at, VALUES(updated_at))"
        }
        c.prepareStatement(sql).use {
            it.setString(1, row.owner); it.setString(2, row.name); it.setString(3, row.value)
            it.setLong(4, row.expiresAt); it.setLong(5, row.updatedAt)
            it.executeUpdate()
        }
    }

    /** [owner]'s rows still valid at [now], cleared ones included (they hide an older value). */
    fun of(owner: String, now: Long): List<Row> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT name, val, expires_at, updated_at FROM ${t.vars} WHERE owner = ? AND (expires_at = 0 OR expires_at > ?)").use { s ->
            s.setString(1, owner); s.setLong(2, now)
            s.executeQuery().use { rs ->
                buildList { while (rs.next()) add(Row(owner, rs.getString(1), rs.getString(2), rs.getLong(3), rs.getLong(4))) }
            }
        }
    }

    /** Deletes the rows expired at [now] and those cleared before [clearedBefore]; the number deleted. */
    fun purge(now: Long, clearedBefore: Long): Int = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.vars} WHERE (expires_at <> 0 AND expires_at <= ?) OR (val IS NULL AND updated_at < ?)").use {
            it.setLong(1, now); it.setLong(2, clearedBefore); it.executeUpdate()
        }
    }
}
