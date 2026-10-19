package net.artisanmc.plugin.database

import java.util.UUID
import javax.sql.DataSource

/** Facts about the suite database itself (`artisan_meta`). */
object ArtisanMeta {
    private val ids = java.util.concurrent.ConcurrentHashMap<DataSource, String>()

    /**
     * Generated once per database: servers of one Network must all announce the same. Read once
     * per pool and kept: `/artisan reload` and config writes ask for it on the main thread.
     */
    fun databaseId(dataSource: DataSource, t: ArtisanTables = ArtisanTables.DEFAULT): String = ids[dataSource] ?: dataSource.connection.use { c ->
        get(c, t, "database_id") ?: runCatching { put(c, t, "database_id", UUID.randomUUID().toString()) }
            .let { get(c, t, "database_id") ?: throw IllegalStateException("${t.meta}: no database_id", it.exceptionOrNull()) }
    }.also { ids[dataSource] = it }

    fun get(c: java.sql.Connection, t: ArtisanTables, name: String): String? =
        c.prepareStatement("SELECT val FROM ${t.meta} WHERE name = ?").use { s ->
            s.setString(1, name); s.executeQuery().use { if (it.next()) it.getString(1) else null }
        }

    /** Insert, never update: the first writer wins, the second gets the key violation. */
    fun put(c: java.sql.Connection, t: ArtisanTables, name: String, value: String) {
        c.prepareStatement("INSERT INTO ${t.meta} (name, val) VALUES (?, ?)").use {
            it.setString(1, name); it.setString(2, value); it.executeUpdate()
        }
    }
}
