package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseApi
import net.artisanmc.modules.api.DatabaseDialect
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
        poolSize = config.getInt("database.pool-size", DatabaseSettings.DEFAULT_POOL_SIZE),
        dataFolder = dataFolder,
    )
}

class PooledDatabase(
    settings: () -> DatabaseSettings,
    logger: Logger,
) : DatabaseApi, Listener {
    private val pools = ConnectionPools(settings, logger)

    override val dialect: DatabaseDialect get() = pools.dialect

    override fun dataSource(owner: Plugin): DataSource = pools.dataSource(owner.name)

    @EventHandler
    fun onPluginDisable(event: PluginDisableEvent) = pools.close(event.plugin.name)

    fun closeAll() = pools.closeAll()
}
