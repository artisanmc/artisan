package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.sql.Connection
import javax.sql.DataSource

/** `artisan_contents` writes: the same hash inserted by two servers at once is one row, not an error. */
internal object Contents {
    fun insertIgnore(c: Connection, dialect: DatabaseDialect, t: ArtisanTables): java.sql.PreparedStatement = c.prepareStatement(
        when (dialect) {
            DatabaseDialect.H2 -> "MERGE INTO ${t.contents} KEY (hash) VALUES (?, ?)"
            DatabaseDialect.MYSQL, DatabaseDialect.MARIADB -> "INSERT IGNORE INTO ${t.contents} (hash, content) VALUES (?, ?)"
        },
    )

    fun put(c: Connection, dialect: DatabaseDialect, t: ArtisanTables, hash: String, bytes: ByteArray) =
        insertIgnore(c, dialect, t).use { it.setString(1, hash); it.setBytes(2, bytes); it.executeUpdate() }
}

/** `artisan_contents` by hash: a draft's images and fonts, before and after publication. */
class ContentRows(
    private val dataSource: DataSource,
    private val dialect: DatabaseDialect = DatabaseDialect.H2,
    private val t: ArtisanTables = ArtisanTables.DEFAULT,
) {
    fun get(hash: String): ByteArray? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT content FROM ${t.contents} WHERE hash = ?").use { s ->
            s.setString(1, hash); s.executeQuery().use { if (it.next()) it.getBytes(1) else null }
        }
    }

    fun put(hash: String, bytes: ByteArray) = dataSource.connection.use { c -> Contents.put(c, dialect, t, hash, bytes) }
}
