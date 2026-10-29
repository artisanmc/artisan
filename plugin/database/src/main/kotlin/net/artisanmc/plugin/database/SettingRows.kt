package net.artisanmc.plugin.database

import java.sql.Timestamp
import java.time.Instant
import javax.sql.DataSource

/**
 * `artisan_settings`: values the editor saves for the whole network (the assistant's `ai`), one row
 * per name. Every method blocks: call them off the game threads.
 */
class SettingRows(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {
    fun get(name: String): String? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT val FROM ${t.settings} WHERE name = ?").use { s ->
            s.setString(1, name)
            s.executeQuery().use { if (it.next()) it.getString(1) else null }
        }
    }

    /** Writes [value] under [name], replacing what was there. */
    fun put(name: String, value: String, now: Instant) = dataSource.connection.use { c ->
        val updated = c.prepareStatement("UPDATE ${t.settings} SET val = ?, updated_at = ? WHERE name = ?").use {
            it.setString(1, value); it.setTimestamp(2, Timestamp.from(now)); it.setString(3, name)
            it.executeUpdate()
        }
        if (updated == 0) {
            c.prepareStatement("INSERT INTO ${t.settings} (name, val, updated_at) VALUES (?, ?, ?)").use {
                it.setString(1, name); it.setString(2, value); it.setTimestamp(3, Timestamp.from(now))
                it.executeUpdate()
            }
        }
    }

    fun delete(name: String) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.settings} WHERE name = ?").use { it.setString(1, name); it.executeUpdate() }
    }
}
