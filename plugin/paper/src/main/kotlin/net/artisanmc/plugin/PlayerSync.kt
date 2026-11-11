package net.artisanmc.plugin

import net.artisanmc.plugin.database.PlayerRow
import net.artisanmc.plugin.database.PlayerRows
import net.artisanmc.plugin.players.PlayerRecord
import net.artisanmc.plugin.players.PlayerRecords
import org.bukkit.Bukkit
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.player.AsyncPlayerPreLoginEvent
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor

/** The play time of the online players written every 5 minutes: a crash loses at most that. */
private const val FLUSH_TICKS = 20L * 60 * 5

/**
 * Keeps `artisan_players` (every player seen on the network) and [PlayerRecords] (what the
 * templates read of the online ones). The row is read at login, off the game threads, so that a
 * join message already knows when the player was last seen; written on [writer] at join, every
 * 5 minutes (this server's share of the play time) and at quit. Without a database, the records
 * live in memory from the join on.
 */
internal class PlayerSync(
    private val rows: () -> PlayerRows?,
    private val writer: Executor,
    private val plugin: ArtisanPlugin,
) : Listener {
    private val logger get() = plugin.logger
    /** Rows read at login, waiting for the join (a login refused later leaves its row here until the next). */
    private val atLogin = ConcurrentHashMap<UUID, PlayerRow>()
    /** Per online player: the instant up to which their play time is written. */
    private val counted = ConcurrentHashMap<UUID, Long>()

    fun start() {
        plugin.server.pluginManager.registerEvents(this, plugin)
        // A reload or a late start: the players already online count from now.
        Bukkit.getOnlinePlayers().forEach { join(it.uniqueId, it.name, it.firstPlayed, null) }
        plugin.scheduler.asyncLater(FLUSH_TICKS) { flush() }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    fun onLogin(event: AsyncPlayerPreLoginEvent) {
        if (event.loginResult != AsyncPlayerPreLoginEvent.Result.ALLOWED) return
        val r = rows() ?: return
        runCatching { r.get(event.uniqueId) }
            .onSuccess { row -> if (row != null) atLogin[event.uniqueId] = row else atLogin.remove(event.uniqueId) }
            .onFailure { logger.warning("[Artisan] Player ${event.name} not read: ${it.message}") }
    }

    /** Before the Triggers (HIGH): a join message reads `{player.last_seen}` of this very join. */
    @EventHandler(priority = EventPriority.LOWEST)
    fun onJoin(event: PlayerJoinEvent) {
        val p = event.player
        join(p.uniqueId, p.name, p.firstPlayed, atLogin.remove(p.uniqueId))
    }

    /** After the Triggers: a quit message still reads the session's play time. */
    @EventHandler(priority = EventPriority.MONITOR)
    fun onQuit(event: PlayerQuitEvent) {
        val id = event.player.uniqueId
        write(id, System.currentTimeMillis())
        counted.remove(id)
        PlayerRecords.remove(id)
    }

    private fun join(id: UUID, name: String, firstPlayed: Long, row: PlayerRow?) {
        val now = System.currentTimeMillis()
        // The server's own first-play date stands in for players who predate the table.
        val firstSeen = row?.firstSeen ?: firstPlayed.takeIf { it in 1..now } ?: now
        PlayerRecords.put(id, PlayerRecord(firstSeen, row?.lastSeen, row?.playtimeMs ?: 0, now))
        counted[id] = now
        writer.execute {
            val r = rows() ?: return@execute
            runCatching { r.seen(id, name, now, firstSeen) }.onFailure { logger.warning("[Artisan] Player $name not stored: ${it.message}") }
        }
    }

    /** Writes [id]'s play time since the last write, up to [now]. */
    private fun write(id: UUID, now: Long) {
        var from = 0L
        counted.computeIfPresent(id) { _, since -> from = since; now } ?: return
        writer.execute {
            val r = rows() ?: return@execute
            runCatching { r.addPlaytime(id, now - from, now) }.onFailure { logger.warning("[Artisan] Play time of $id not stored: ${it.message}") }
        }
    }

    private fun flush() {
        if (!plugin.isEnabled) return
        val now = System.currentTimeMillis()
        counted.keys.forEach { write(it, now) }
        plugin.scheduler.asyncLater(FLUSH_TICKS) { flush() }
    }
}
