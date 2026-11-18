package net.artisanmc.plugin

import net.artisanmc.plugin.config.StatsExportConfig
import net.artisanmc.plugin.stats.ExportSource
import net.artisanmc.plugin.stats.ExportTransport
import net.artisanmc.plugin.stats.ExportedPlayer
import net.artisanmc.plugin.stats.ExportedValue
import net.artisanmc.plugin.stats.StatsExport
import net.artisanmc.plugin.stats.StatsRecorder
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * The push of player metrics to the admin's website (ADR `stats-export`), on the servers whose
 * `environment.yml` sets `stats-export`: every `interval-seconds`, off the game threads, the
 * metrics that changed since the website's cursor. A failure is logged at most every 10 minutes
 * and the next run starts over from the same cursor: nothing is lost while the website is down.
 */
internal class StatsExportHost(private val plugin: ArtisanPlugin, private val recorder: StatsRecorder) {
    private val logger get() = plugin.logger
    @Volatile private var export: StatsExport? = null
    @Volatile private var stopped = false
    @Volatile private var lastFailure = 0L
    @Volatile private var failing = false

    fun start() {
        val cfg = plugin.loadedConfigOrNull() ?: return
        val settings = cfg.statsExport
        if (!settings.enabled) return
        val uri = runCatching { URI(settings.url) }.getOrNull()
        if (uri == null || uri.scheme !in setOf("https", "http") || uri.host.isNullOrEmpty()) {
            logger.warning("[Artisan] stats-export.url \"${settings.url}\" in environment.yml is not an http(s) address: nothing is exported")
            return
        }
        if (uri.scheme == "http" && uri.host !in LOCAL_HOSTS) {
            logger.warning("[Artisan] stats-export.url is plain http: the token travels in clear. Use https.")
        }
        // The suite database may open after this start: read at each run.
        val source = object : ExportSource {
            private fun rows() = plugin.suite.metricRows() ?: throw IllegalStateException("the suite database is not open")
            override fun values(since: Long, until: Long, after: ExportedValue?, limit: Int) = rows().values(since, until, after, limit)
            override fun players(since: Long, until: Long, after: ExportedPlayer?, limit: Int) = rows().players(since, until, after, limit)
        }
        val name = plugin.networkName(cfg.web) ?: plugin.serverUuid
        export = StatsExport(source, transport(uri, settings), { recorder.declaredMetrics() }, name)
        logger.info("[Artisan] Player metrics exported to ${uri.host} every ${settings.intervalSeconds} s")
        plugin.scheduler.asyncLater(FIRST_RUN_TICKS) { loop(settings.intervalSeconds) }
    }

    fun stop() {
        stopped = true
    }

    private fun loop(intervalSeconds: Int) {
        if (stopped || !plugin.isEnabled) return
        val export = export ?: return
        try {
            val run = export.run()
            if (failing) logger.info("[Artisan] Player metrics export works again")
            failing = false
            if (run.resync) logger.info("[Artisan] The website holds no metrics: everything is sent again on the next run")
            else if (run.values + run.players + run.forgotten > 0) {
                logger.fine("[Artisan] Exported ${run.players} players, ${run.values} values, ${run.forgotten} forgotten in ${run.pages} pages")
            }
        } catch (e: Exception) {
            failing = true
            val now = System.currentTimeMillis()
            if (now - lastFailure > FAILURE_LOG_MS) {
                lastFailure = now
                logger.warning("[Artisan] Player metrics not exported, retried every $intervalSeconds s: ${e.message}")
            }
        }
        plugin.scheduler.asyncLater(intervalSeconds * 20L) { loop(intervalSeconds) }
    }

    private fun transport(uri: URI, settings: StatsExportConfig): ExportTransport {
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build()
        return ExportTransport { json ->
            val request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer ${settings.token}")
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("User-Agent", "Artisan")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                val hint = when (response.statusCode()) {
                    401, 403 -> " (check stats-export.token)"
                    404 -> " (check stats-export.url and that the website's plugin is enabled)"
                    else -> ""
                }
                throw IllegalStateException("the website answered ${response.statusCode()}$hint")
            }
            response.body()
        }
    }

    private companion object {
        const val FIRST_RUN_TICKS = 20L * 30
        const val FAILURE_LOG_MS = 10 * 60 * 1000L
        val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "::1")
    }
}
