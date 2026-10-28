package net.artisanmc.plugin

import net.artisanmc.plugin.database.CooldownRows
import net.artisanmc.plugin.engine.CooldownStore
import org.bukkit.Bukkit
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import java.util.UUID
import java.util.concurrent.Executor

/** Server-wide cooldowns read again every 30 s: a network shares them within that delay. */
private const val REFRESH_TICKS = 20L * 30
/** Expired rows deleted once a day, at the refresh that crosses it. */
private const val PURGE_EVERY = 20L * 60 * 60 * 24 / REFRESH_TICKS

/**
 * Keeps the [store]'s cooldowns in `artisan_cooldowns` (decision Q4 of `design-framework-commandes`):
 * each one set is written on [writer], the suite database's single writer; a player's are read
 * when they join, the server-wide ones every 30 s. A check never touches the database: until a
 * read lands, memory decides. Without a database ([rows] null), memory alone, as before.
 */
internal class CooldownSync(
    private val store: CooldownStore,
    private val rows: () -> CooldownRows?,
    private val writer: Executor,
    private val plugin: ArtisanPlugin,
) : Listener {
    private val logger get() = plugin.logger
    @Volatile private var loadedOnline = false
    private var refreshes = 0L

    fun start() {
        store.onSet = { id, subject, expiresAt ->
            writer.execute {
                val r = rows() ?: return@execute
                runCatching { r.put(id, subject, expiresAt) }
                    .onFailure { logger.warning("[Artisan] Cooldown '$id' not stored: ${it.message}") }
            }
        }
        plugin.server.pluginManager.registerEvents(this, plugin)
        plugin.scheduler.async { refresh() }
    }

    @EventHandler
    fun onJoin(event: PlayerJoinEvent) {
        val id = event.player.uniqueId
        plugin.scheduler.async { loadPlayer(id) }
    }

    private fun refresh() {
        if (!plugin.isEnabled) return
        val r = rows()
        if (r != null) {
            val now = System.currentTimeMillis()
            runCatching { store.loadGlobal(r.running(CooldownStore.GLOBAL, now)) }
                .onFailure { logger.warning("[Artisan] Server-wide cooldowns not read: ${it.message}") }
            // The database opens after the start: the players already online are read once it does.
            if (!loadedOnline) {
                loadedOnline = true
                Bukkit.getOnlinePlayers().map { it.uniqueId }.forEach(::loadPlayer)
            }
            if (refreshes++ % PURGE_EVERY == PURGE_EVERY - 1) {
                runCatching { r.purge(now) }.onFailure { logger.warning("[Artisan] Expired cooldowns not purged: ${it.message}") }
            }
        }
        store.prune()
        plugin.scheduler.asyncLater(REFRESH_TICKS) { refresh() }
    }

    private fun loadPlayer(id: UUID) {
        val r = rows() ?: return
        runCatching { store.loadPlayer(id, r.running(id.toString(), System.currentTimeMillis())) }
            .onFailure { logger.warning("[Artisan] Cooldowns of $id not read: ${it.message}") }
    }
}
