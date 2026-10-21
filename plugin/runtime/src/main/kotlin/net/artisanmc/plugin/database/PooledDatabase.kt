package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseApi
import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.plugin.config.EnvironmentFile
import org.bukkit.configuration.ConfigurationSection
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.server.PluginDisableEvent
import org.bukkit.plugin.Plugin
import java.io.File
import java.util.logging.Logger
import javax.sql.DataSource

fun readDatabaseSettings(
    environment: ConfigurationSection,
    config: ConfigurationSection,
    dataFolder: File,
    onMissingEnv: (String) -> Unit = {},
): DatabaseSettings {
    fun env(key: String, default: String) = EnvironmentFile.string(environment, "database.$key", default, onMissingEnv)
    return DatabaseSettings.of(
        type = env("type", "h2"),
        host = env("host", "localhost"),
        port = env("port", "3306"),
        name = env("name", "minecraft"),
        user = env("user", "root"),
        password = env("password", ""),
        // Before environment.yml held it, the pool size lived in config.yml: still read from there.
        poolSize = env("pool-size", config.getInt("database.pool-size", DatabaseSettings.DEFAULT_POOL_SIZE).toString())
            .toIntOrNull() ?: DatabaseSettings.DEFAULT_POOL_SIZE,
        dataFolder = dataFolder,
        tablePrefix = env("table-prefix", TablePrefix.DEFAULT),
    )
}

class PooledDatabase(
    private val settings: () -> DatabaseSettings,
    logger: Logger,
) : DatabaseApi, Listener {
    private val pools = ConnectionPools(settings, logger)

    /** Read once: tables keep the names they were opened with until the next start. */
    private val prefix: String by lazy { TablePrefix.validate(settings().tablePrefix) }

    /** [TablePrefix.checkUnchanged], once, on the first pool opened; its failure is every later call's. */
    @Volatile private var prefixChecked: Result<Unit>? = null

    /** Artisan's own table names. */
    val tables: ArtisanTables get() = ArtisanTables(getTablePrefix())

    override fun getDialect(): DatabaseDialect = pools.dialect

    override fun dataSource(owner: Plugin): DataSource {
        val pool = pools.dataSource(owner.name)
        val checked = prefixChecked ?: synchronized(this) {
            prefixChecked ?: runCatching { TablePrefix.checkUnchanged(prefix, settings().prefixFile, pool) }.also { prefixChecked = it }
        }
        checked.getOrElse { pools.close(owner.name); throw it }
        return pool
    }

    override fun getTablePrefix(): String = prefix

    override fun tablePrefix(module: String): String = TablePrefix.module(prefix, module)

    @EventHandler
    fun onPluginDisable(event: PluginDisableEvent) = pools.close(event.plugin.name)

    fun closeAll() = pools.closeAll()
}
