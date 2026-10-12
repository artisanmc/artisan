package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.io.File
import java.util.Locale

data class DatabaseSettings(
    val dialect: DatabaseDialect?,
    val type: String,
    val host: String,
    val port: Int,
    val name: String,
    val user: String,
    val password: String,
    val poolSize: Int,
    val h2Dir: File,
) {
    override fun toString() = "DatabaseSettings($type, $host:$port/$name, user=$user, poolSize=$poolSize)"

    companion object {
        const val DEFAULT_POOL_SIZE = 4

        fun of(
            type: String,
            host: String,
            port: String,
            name: String,
            user: String,
            password: String,
            poolSize: Int,
            dataFolder: File,
        ): DatabaseSettings {
            val normalized = type.trim().lowercase(Locale.ROOT)
            return DatabaseSettings(
                dialect = when (normalized) {
                    "h2" -> DatabaseDialect.H2
                    "mysql" -> DatabaseDialect.MYSQL
                    "mariadb" -> DatabaseDialect.MARIADB
                    else -> null
                },
                type = normalized,
                host = host,
                port = port.toIntOrNull() ?: 3306,
                name = name,
                user = user,
                password = password,
                poolSize = poolSize.coerceIn(1, 50),
                h2Dir = File(dataFolder, "database"),
            )
        }
    }
}
