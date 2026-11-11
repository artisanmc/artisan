package net.artisanmc.plugin.database

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import net.artisanmc.modules.api.database.DatabaseDialect
import java.io.File
import java.util.logging.Logger
import javax.sql.DataSource

class ConnectionPools(
    private val settings: () -> DatabaseSettings,
    private val logger: Logger,
) {
    private val pools = HashMap<String, HikariDataSource>()
    /** Pools of disabled plugins, open until [closeReleased] unless their plugin asks again (a reload). */
    private val released = HashMap<String, HikariDataSource>()

    companion object {
        const val H2_FILE = "suite"
    }

    val dialect: DatabaseDialect get() = settings().let { it.dialect ?: unknownType(it) }

    @Synchronized
    fun dataSource(owner: String): DataSource {
        released.remove(owner)
        pools[owner]?.takeUnless { it.isClosed }?.let { return it }
        return open(owner, settings()).also { pools[owner] = it }
    }

    @Synchronized
    fun close(owner: String) {
        pools.remove(owner)?.let {
            it.close()
            logger.info("[database] pool of $owner closed")
        }
    }

    /** Marks [owner]'s pool for [closeReleased]; false if it has none. */
    @Synchronized
    fun release(owner: String): Boolean {
        val pool = pools[owner] ?: return false
        released[owner] = pool
        return true
    }

    /** Closes [owner]'s released pool, unless the plugin took it back since. */
    @Synchronized
    fun closeReleased(owner: String) {
        val pool = released.remove(owner) ?: return
        if (pools[owner] === pool) close(owner)
    }

    @Synchronized
    fun closeAll() = pools.keys.toList().forEach(::close)

    private fun open(owner: String, s: DatabaseSettings): HikariDataSource {
        val dialect = s.dialect ?: unknownType(s)
        val url = when (dialect) {
            DatabaseDialect.H2 -> "jdbc:h2:file:" + File(s.h2Dir, H2_FILE).absolutePath
            DatabaseDialect.MYSQL -> "jdbc:mysql://${s.host}:${s.port}/${s.name}"
            DatabaseDialect.MARIADB -> "jdbc:mariadb://${s.host}:${s.port}/${s.name}"
        }
        val pool = try {
            HikariDataSource(
                HikariConfig().apply {
                    poolName = "Artisan-$owner"
                    maximumPoolSize = s.poolSize
                    minimumIdle = 1
                    connectionTimeout = 10_000
                    jdbcUrl = url
                    if (dialect == DatabaseDialect.H2) {
                        s.h2Dir.mkdirs()
                        driverClassName = "org.h2.Driver"
                    } else {
                        driverClassName =
                            if (dialect == DatabaseDialect.MYSQL) "com.mysql.cj.jdbc.Driver" else "org.mariadb.jdbc.Driver"
                        username = s.user
                        password = s.password
                        addDataSourceProperty("cachePrepStmts", "true")
                        addDataSourceProperty("prepStmtCacheSize", "250")
                        addDataSourceProperty("prepStmtCacheSqlLimit", "2048")
                        addDataSourceProperty("useServerPrepStmts", "true")
                        addDataSourceProperty("rewriteBatchedStatements", "true")
                    }
                },
            )
        } catch (e: Exception) {
            throw IllegalStateException(
                "Artisan could not open the database pool of $owner (${s.type} $url): ${e.message}. " +
                    "Check the database section of plugins/Artisan/environment.yml.",
                e,
            )
        }
        logger.info("[database] pool of $owner opened (${s.type}, ${s.poolSize} connections max)")
        return pool
    }

    private fun unknownType(s: DatabaseSettings): Nothing = throw IllegalStateException(
        "Unknown database.type '${s.type}' in plugins/Artisan/environment.yml (expected h2, mysql or mariadb)",
    )
}
