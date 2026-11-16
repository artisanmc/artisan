package net.artisanmc.plugin

import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.modules.api.stats.StatKind
import net.artisanmc.modules.api.stats.StatScope
import net.artisanmc.modules.api.stats.StatStorage
import net.artisanmc.plugin.config.StatsConfig
import net.artisanmc.plugin.stats.StatsMaintenance
import net.artisanmc.plugin.stats.StatsRecorder
import net.artisanmc.plugin.stats.flushTo
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Artisan's own Stat events (ADR `stats-foundation` ⑩). */
internal object CoreStats {
    const val SESSION = "core:session"
    const val FIRST_JOIN = "core:first_join"
    const val PLAYERS_ONLINE = "core:players_online"
    const val COMMAND = "core:command"
    const val MENU_OPEN = "core:menu_open"
    const val MENU_CLICK = "core:menu_click"

    val ALL: List<StatEvent> = listOf(
        StatEvent.builder(SESSION).storage(StatStorage.RAW).value("duration_seconds").build(),
        StatEvent.builder(FIRST_JOIN).storage(StatStorage.RAW).build(),
        StatEvent.builder(PLAYERS_ONLINE).kind(StatKind.GAUGE).scope(StatScope.SERVER).value("players").build(),
        StatEvent.builder(COMMAND).dimensions("command", "sub", "result").build(),
        StatEvent.builder(MENU_OPEN).dimensions("menu").build(),
        StatEvent.builder(MENU_CLICK).dimensions("menu", "element").build(),
    )
}

/**
 * Statistics on this server (ADR `stats-foundation`): the recorder behind `api.getStats()`, its
 * flush every `stats.flush-seconds` off the game threads and at shutdown, the daily rollup and
 * purge, and what Artisan itself records ([CoreStats]). Records made before the suite database
 * opens wait in the buffer.
 */
internal class StatsHost(private val plugin: ArtisanPlugin) : Listener {
    private val logger get() = plugin.logger

    val recorder = StatsRecorder(
        warn = { logger.warning("[Artisan] $it") },
        settings = { config().settings },
    ).also { r -> CoreStats.ALL.forEach(r::declareCore) }

    /** Per online player: when their session started on this server. */
    private val sessions = ConcurrentHashMap<UUID, Long>()
    private val flushLock = Any()
    @Volatile private var lastFailure = 0L

    private fun config(): StatsConfig = plugin.loadedConfigOrNull()?.stats ?: StatsConfig()

    fun start() {
        plugin.server.pluginManager.registerEvents(this, plugin)
        val now = System.currentTimeMillis()
        plugin.server.onlinePlayers.forEach { sessions[it.uniqueId] = now }
        plugin.menuEvents.onOpen { event ->
            // A repaint (pagination, `set`) reopens the menu the player already has: one opening, not two.
            val current = plugin.runtime.sessionsOrNull?.get(event.player)?.ref
            if (!event.isCancelled && current != event.menu) {
                recorder.record(CoreStats.MENU_OPEN, event.player.uniqueId, mapOf("menu" to event.menu.toString()))
            }
        }
        plugin.menuEvents.onClick { event ->
            if (!event.hasActions() || event.isCancelled) return@onClick
            val element = plugin.runtime.sessionsOrNull?.get(event.player)?.slotElements?.get(event.slot).orEmpty()
            recorder.record(CoreStats.MENU_CLICK, event.player.uniqueId, mapOf("menu" to event.menu.toString(), "element" to element))
        }
        plugin.scheduler.asyncLater(config().flushSeconds * 20L) { flushLoop() }
        plugin.scheduler.asyncLater(ONLINE_TICKS) { onlineLoop() }
        plugin.scheduler.asyncLater(FIRST_MAINTENANCE_TICKS) { maintenanceLoop() }
    }

    /** At shutdown, before the database closes: the open sessions end here, and the buffer is written. */
    fun stop() {
        val now = System.currentTimeMillis()
        sessions.keys.toList().forEach { endSession(it, now) }
        flush()
    }

    /** A command of a `command/v1` document ran, or was refused: `result` is ok, permission, cooldown or condition. */
    fun command(player: Player, command: String, sub: String, result: String) =
        recorder.record(CoreStats.COMMAND, player.uniqueId, mapOf("command" to command, "sub" to sub, "result" to result))

    /** The player's first visit on the network (`artisan_players` had no row of them). */
    fun firstJoin(player: UUID) = recorder.record(CoreStats.FIRST_JOIN, player, emptyMap())

    /** Erases [player]'s statistics, buffered and stored; the number of rows deleted, null without a database. */
    fun forget(player: UUID): Int? {
        recorder.buffer.forget(player.toString())
        val rows = plugin.suite.statsRows() ?: return null
        return synchronized(flushLock) { rows.forget(player.toString()) }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    fun onJoin(event: PlayerJoinEvent) {
        sessions[event.player.uniqueId] = System.currentTimeMillis()
    }

    @EventHandler(priority = EventPriority.MONITOR)
    fun onQuit(event: PlayerQuitEvent) = endSession(event.player.uniqueId, System.currentTimeMillis())

    private fun endSession(player: UUID, now: Long) {
        val since = sessions.remove(player) ?: return
        recorder.record(CoreStats.SESSION, player, emptyMap(), (now - since) / 1000.0, mapOf("started_at" to since.toString()))
    }

    /** Writes the buffer; a failure keeps it for the next flush and is logged once a minute at most. */
    fun flush() {
        val writer = plugin.suite.statsWriter() ?: return
        synchronized(flushLock) {
            try {
                recorder.flushTo(writer)
            } catch (e: Exception) {
                val now = System.currentTimeMillis()
                if (now - lastFailure > 60_000) {
                    lastFailure = now
                    logger.warning("[Artisan] Statistics not written, kept in memory for the next try: ${e.message}")
                }
            }
        }
    }

    private fun flushLoop() {
        if (!plugin.isEnabled) return
        flush()
        plugin.scheduler.asyncLater(config().flushSeconds * 20L) { flushLoop() }
    }

    private fun onlineLoop() {
        if (!plugin.isEnabled) return
        plugin.scheduler.global {
            recorder.recordServer(CoreStats.PLAYERS_ONLINE, emptyMap(), plugin.server.onlinePlayers.size.toDouble())
        }
        plugin.scheduler.asyncLater(ONLINE_TICKS) { onlineLoop() }
    }

    private fun maintenanceLoop() {
        if (!plugin.isEnabled) return
        val writer = plugin.suite.statsWriter()
        val cfg = config()
        if (writer != null && cfg.settings.enabled) {
            synchronized(flushLock) {
                runCatching { StatsMaintenance.run(writer, System.currentTimeMillis(), cfg.retention, cfg.zone, recorder.rawRetentions()) }
                    .onFailure { logger.warning("[Artisan] Statistics not merged or purged: ${it.message}") }
            }
        }
        plugin.scheduler.asyncLater(MAINTENANCE_TICKS) { maintenanceLoop() }
    }

    private companion object {
        const val ONLINE_TICKS = 20L * 60
        const val FIRST_MAINTENANCE_TICKS = 20L * 60 * 10
        const val MAINTENANCE_TICKS = 20L * 60 * 60 * 24
    }
}
