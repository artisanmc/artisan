package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import javax.sql.DataSource

/**
 * `artisan_cooldowns`: one row per cooldown and subject (a player's UUID, or `*` for a
 * server-wide one), its expiry in epoch milliseconds. Written as cooldowns start, read when a
 * player joins and every few seconds for the server-wide ones, expired rows purged once a day.
 */
class CooldownRows(
    private val dataSource: DataSource,
    private val dialect: DatabaseDialect = DatabaseDialect.H2,
    private val t: ArtisanTables = ArtisanTables.DEFAULT,
) {
    /** Sets [subject]'s [cooldownId] to expire at [expiresAt], whatever it held: two servers writing at once keep the last write. */
    fun put(cooldownId: String, subject: String, expiresAt: Long) = dataSource.connection.use { c ->
        val sql = when (dialect) {
            DatabaseDialect.H2 -> "MERGE INTO ${t.cooldowns} (cooldown_id, subject, expires_at) KEY (cooldown_id, subject) VALUES (?, ?, ?)"
            DatabaseDialect.MYSQL, DatabaseDialect.MARIADB ->
                "INSERT INTO ${t.cooldowns} (cooldown_id, subject, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)"
        }
        c.prepareStatement(sql).use {
            it.setString(1, cooldownId); it.setString(2, subject); it.setLong(3, expiresAt)
            it.executeUpdate()
        }
    }

    /** [subject]'s cooldowns still running at [now], by id. */
    fun running(subject: String, now: Long): Map<String, Long> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT cooldown_id, expires_at FROM ${t.cooldowns} WHERE subject = ? AND expires_at > ?").use { s ->
            s.setString(1, subject); s.setLong(2, now)
            s.executeQuery().use { rs -> buildMap { while (rs.next()) put(rs.getString(1), rs.getLong(2)) } }
        }
    }

    /** Deletes the rows expired at [now]; the number deleted. */
    fun purge(now: Long): Int = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.cooldowns} WHERE expires_at <= ?").use { it.setLong(1, now); it.executeUpdate() }
    }
}
