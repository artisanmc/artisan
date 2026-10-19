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
    )
}

/**
 * One pool per plugin of the suite. [later] runs a task after a delay in ticks: the pool of a
 * disabling plugin closes through it, see [onPluginDisable].
 */
class PooledDatabase(
    settings: () -> DatabaseSettings,
    logger: Logger,
    private val later: (Long, () -> Unit) -> Unit = { _, task -> task() },
) : DatabaseApi, Listener {
    private val pools = ConnectionPools(settings, logger)

    override fun getDialect(): DatabaseDialect = pools.dialect

    override fun dataSource(owner: Plugin): DataSource = pools.dataSource(owner.name)

    /**
     * The event fires before the plugin's onDisable, which may still save to its pool: the pool
     * closes [CLOSE_DELAY_TICKS] later. A plugin reloader enables the plugin again within that
     * delay, and its [dataSource] gets the same pool back.
     */
    @EventHandler
    fun onPluginDisable(event: PluginDisableEvent) {
        val owner = event.plugin.name
        if (!pools.release(owner)) return
        runCatching { later(CLOSE_DELAY_TICKS) { pools.closeReleased(owner) } }.onFailure { pools.closeReleased(owner) }
    }

    fun closeAll() = pools.closeAll()

    companion object {
        /** Leaves the writes a plugin queues in its onDisable 5 seconds to finish. */
        const val CLOSE_DELAY_TICKS = 100L
    }
}
