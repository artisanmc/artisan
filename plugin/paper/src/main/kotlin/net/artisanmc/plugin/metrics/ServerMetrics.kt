package net.artisanmc.plugin.metrics

import net.artisanmc.plugin.config.PluginConfig
import org.bstats.bukkit.Metrics
import org.bstats.charts.AdvancedPie
import org.bstats.charts.SimplePie
import org.bukkit.plugin.java.JavaPlugin

/**
 * Anonymous install counts on bStats (https://bstats.org/plugin/bukkit/Artisan/[SERVICE_ID]).
 * The server owner turns them off for every plugin in `plugins/bStats/config.yml`.
 *
 * On Folia bStats calls the charts from its own thread: each one reads only thread-safe state
 * (the module list is a copy-on-write list, the config an immutable snapshot).
 */
internal class ServerMetrics(
    private val plugin: JavaPlugin,
    private val moduleIds: () -> List<String>,
    private val config: () -> PluginConfig,
    private val databaseType: () -> String,
) {
    private var metrics: Metrics? = null

    fun start() {
        if (!enabled()) return
        metrics = runCatching { Metrics(plugin, SERVICE_ID) }
            .onFailure { plugin.logger.warning("[Artisan] bStats metrics unavailable: ${it.message}") }
            .getOrNull()
            ?.apply {
                addCustomChart(AdvancedPie("modules") { MetricsCharts.modules(moduleIds()) })
                addCustomChart(SimplePie("web_role") { MetricsCharts.webRole(config().web) })
                addCustomChart(SimplePie("database") { MetricsCharts.database(databaseType()) })
                addCustomChart(SimplePie("language") { MetricsCharts.language(config().language) })
            }
    }

    fun stop() {
        metrics?.shutdown()
        metrics = null
    }

    companion object {
        /** Artisan's service on bStats. 0: not registered yet, nothing is sent. */
        const val SERVICE_ID = 0

        /** Set to `false` to never start bStats: the Gradle tests do, so no test reports an install. */
        const val PROPERTY = "artisan.metrics"

        fun enabled(): Boolean = SERVICE_ID > 0 && System.getProperty(PROPERTY) != "false"
    }
}
