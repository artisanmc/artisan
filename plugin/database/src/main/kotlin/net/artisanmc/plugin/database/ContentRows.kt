package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.sql.Connection
import javax.sql.DataSource

/** `artisan_contents` writes: the same hash inserted by two servers at once is one row, not an error. */
internal object Contents {
    fun insertIgnore(c: Connection, dialect: DatabaseDialect): java.sql.PreparedStatement = c.prepareStatement(
        when (dialect) {
            DatabaseDialect.H2 -> "MERGE INTO artisan_contents KEY (hash) VALUES (?, ?)"
            DatabaseDialect.MYSQL, DatabaseDialect.MARIADB -> "INSERT IGNORE INTO artisan_contents (hash, content) VALUES (?, ?)"
        },
    )

    fun put(c: Connection, dialect: DatabaseDialect, hash: String, bytes: ByteArray) =
        insertIgnore(c, dialect).use { it.setString(1, hash); it.setBytes(2, bytes); it.executeUpdate() }
}

/** `artisan_contents` by hash: a draft's images and fonts, before and after publication. */
class ContentRows(private val dataSource: DataSource, private val dialect: DatabaseDialect = DatabaseDialect.H2) {
    fun get(hash: String): ByteArray? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT content FROM artisan_contents WHERE hash = ?").use { s ->
            s.setString(1, hash); s.executeQuery().use { if (it.next()) it.getBytes(1) else null }
        }
    }

    fun put(hash: String, bytes: ByteArray) = dataSource.connection.use { c -> Contents.put(c, dialect, hash, bytes) }
}
