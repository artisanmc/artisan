package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import org.bukkit.configuration.ConfigurationSection
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.plugin.Plugin
import java.io.File
import java.util.logging.Logger
import javax.sql.DataSource

/**
 * The suite's database for a plugin that runs with or without the Artisan plugin (ADR
 * `runtime-library` ⑤, amendment of `suite-foundation-database`): the plugin opens its own
 * pool from its copy of the runtime, the settings come from one place the admin knows.
 *
 * - `plugins/Artisan/environment.yml` exists: its `database` section is read (`${VAR}`
 *   references included). Nothing is ever written there.
 * - It does not exist: the plugin's own `database` section, written with the defaults
 *   (H2) when the config has none, so the plugin starts with nothing to set up.
 * - `database.own: true` in the plugin's config keeps its own section whatever Artisan's
 *   file says, for a plugin that must reach another database.
 *
 * The H2 file lives under the plugin's own folder (`database/suite.mv.db`): one file per
 * plugin, two JVM copies of H2 cannot share one. One database for the suite in MySQL and
 * MariaDB, each plugin prefixing its tables, as before.
 */
class ModuleDatabase private constructor(
    val settings: DatabaseSettings,
    /** Where the settings were read: the path of Artisan's file, or `config.yml`. */
    val source: String,
    logger: Logger,
) {
    private val pools = ConnectionPools({ settings }, logger)

    val dialect: DatabaseDialect get() = pools.dialect

    /** The plugin's pool, opened on the first call (it checks a connection): call it from `onEnable`. */
    fun dataSource(owner: String): DataSource = pools.dataSource(owner)

    fun close() = pools.closeAll()

    companion object {
        const val ARTISAN_ENVIRONMENT = "Artisan/environment.yml"

        /** [plugin]'s database: Artisan's `environment.yml` next to it, else its own `config.yml`. */
        fun of(plugin: Plugin, onMissingEnv: (String) -> Unit = {}): ModuleDatabase = resolve(
            pluginName = plugin.name,
            dataFolder = plugin.dataFolder,
            config = plugin.config,
            saveConfig = plugin::saveConfig,
            artisanEnvironment = File(plugin.server.pluginsFolder, ARTISAN_ENVIRONMENT),
            logger = plugin.logger,
            onMissingEnv = onMissingEnv,
        )

        fun resolve(
            pluginName: String,
            dataFolder: File,
            config: ConfigurationSection,
            saveConfig: () -> Unit,
            artisanEnvironment: File,
            logger: Logger,
            onMissingEnv: (String) -> Unit = {},
        ): ModuleDatabase {
            val own = config.getBoolean("database.own", false)
            val (section, source) = when {
                !own && artisanEnvironment.isFile ->
                    YamlConfiguration.loadConfiguration(artisanEnvironment) to artisanEnvironment.path
                else -> ownSection(config, saveConfig) to "config.yml"
            }
            val settings = readDatabaseSettings(section, config, dataFolder, onMissingEnv)
            logger.info("[database] $pluginName reads its database settings from $source ($settings)")
            return ModuleDatabase(settings, source, logger)
        }

        /** The plugin's own `database` section, written with the defaults when it has none. */
        private fun ownSection(config: ConfigurationSection, saveConfig: () -> Unit): ConfigurationSection {
            config.getConfigurationSection("database")?.let { return config }
            config.createSection(
                "database",
                linkedMapOf(
                    "type" to "h2",
                    "host" to "localhost",
                    "port" to 3306,
                    "name" to "minecraft",
                    "user" to "root",
                    "password" to "",
                    "pool-size" to DatabaseSettings.DEFAULT_POOL_SIZE,
                ),
            )
            saveConfig()
            return config
        }
    }
}
