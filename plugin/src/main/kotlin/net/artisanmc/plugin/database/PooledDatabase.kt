package net.artisanmc.plugin.database

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import net.artisanmc.modules.api.DatabaseApi
import net.artisanmc.modules.api.DatabaseDialect
import net.artisanmc.plugin.config.EnvironmentFile
import org.bukkit.configuration.ConfigurationSection
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.server.PluginDisableEvent
import org.bukkit.plugin.Plugin
import java.io.File
import java.util.Locale
import java.util.logging.Logger
import javax.sql.DataSource

/** What a pool needs, read from `environment.yml` (credentials) and `config.yml` (pool size). */
data class DatabaseSettings(
    /** Null when `database.type` is not a known dialect: every call then fails with [type] in the message. */
    val dialect: DatabaseDialect?,
    val type: String,
    val host: String,
    val port: Int,
    val name: String,
    val user: String,
    val password: String,
    val poolSize: Int,
    /** Directory of the H2 database shared by the suite. */
    val h2Dir: File,
) {
    override fun toString() = "DatabaseSettings($type, $host:$port/$name, user=$user, poolSize=$poolSize)"

    companion object {
        const val DEFAULT_POOL_SIZE = 4

        fun from(
            environment: ConfigurationSection,
            config: ConfigurationSection,
            dataFolder: File,
            onMissingEnv: (String) -> Unit = {},
        ): DatabaseSettings {
            fun env(key: String, default: String) = EnvironmentFile.string(environment, "database.$key", default, onMissingEnv)
            val type = env("type", "h2").trim().lowercase(Locale.ROOT)
            return DatabaseSettings(
                dialect = when (type) {
                    "h2" -> DatabaseDialect.H2
                    "mysql" -> DatabaseDialect.MYSQL
                    "mariadb" -> DatabaseDialect.MARIADB
                    else -> null
                },
                type = type,
                host = env("host", "localhost"),
                port = env("port", "3306").toIntOrNull() ?: 3306,
                name = env("name", "minecraft"),
                user = env("user", "root"),
                password = env("password", ""),
                poolSize = config.getInt("database.pool-size", DEFAULT_POOL_SIZE).coerceIn(1, 50),
                h2Dir = File(dataFolder, "database"),
            )
        }
    }
}

/**
 * [DatabaseApi] backed by one HikariCP pool per plugin over a single database (ADR `suite-foundation-database`).
 * Settings are read when a pool opens, so a change applies to pools opened
 * afterwards. HikariCP and the drivers come from `libraries:` in `plugin.yml`
 * and stay in Artisan's classloader: only [DataSource] reaches the plugins.
 */
class PooledDatabase(
    private val settings: () -> DatabaseSettings,
    private val logger: Logger,
) : DatabaseApi, Listener {
    private val pools = HashMap<String, HikariDataSource>()

    companion object {
        /**
         * One H2 database for the whole suite, like the shared MySQL one: plugins
         * prefix their tables and may reference Artisan's (e.g. a server table).
         * The pools all live in Artisan's JVM, so embedded mode allows it.
         */
        const val H2_FILE = "suite"
    }

    override val dialect: DatabaseDialect get() = settings().let { it.dialect ?: unknownType(it) }

    @Synchronized
    override fun dataSource(owner: Plugin): DataSource {
        pools[owner.name]?.takeUnless { it.isClosed }?.let { return it }
        return open(owner.name, settings()).also { pools[owner.name] = it }
    }

    /** Pool of a disabled plugin is closed: its next `onEnable` gets a fresh one. */
    @EventHandler
    fun onPluginDisable(event: PluginDisableEvent) = close(event.plugin.name)

    @Synchronized
    fun close(owner: String) {
        pools.remove(owner)?.let {
            it.close()
            logger.info("[database] pool of $owner closed")
        }
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
