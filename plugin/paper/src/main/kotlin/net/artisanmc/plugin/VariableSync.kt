package net.artisanmc.plugin

import net.artisanmc.plugin.database.VariableRows
import net.artisanmc.plugin.engine.ProjectVariable
import net.artisanmc.plugin.engine.VariableStore
import org.bukkit.Bukkit
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import java.util.UUID
import java.util.concurrent.Executor

/** Server-wide values read again every 30 s: a network shares them within that delay. */
private const val REFRESH_TICKS = 20L * 30
/** Expired and cleared rows deleted once a day, at the refresh that crosses it. */
private const val PURGE_EVERY = 20L * 60 * 60 * 24 / REFRESH_TICKS

/**
 * Keeps the [store]'s Project variables in `artisan_vars` (ADR `triggers-and-variables` §5), the
 * scheme of [CooldownSync]: each write goes to [writer], the suite database's single writer; a
 * player's values are read when they join, the server-wide ones every 30 s. A read never touches
 * the database: until a load lands, memory decides. Without a database ([rows] null), memory alone,
 * lost at restart (said once at startup).
 */
internal class VariableSync(
    private val store: VariableStore,
    private val rows: () -> VariableRows?,
    private val writer: Executor,
    private val plugin: ArtisanPlugin,
) : Listener {
    private val logger get() = plugin.logger
    @Volatile private var loadedOnline = false
    @Volatile private var warnedNoDatabase = false
    private var refreshes = 0L

    fun start() {
        store.onWrite = { ref, owner, entry ->
            writer.execute {
                val r = rows() ?: return@execute
                val row = VariableRows.Row(owner, ref, entry.value?.let(ProjectVariable::encode), entry.expiresAt, entry.updatedAt)
                runCatching { r.put(row) }
                    .onFailure { logger.warning("[Artisan] Variable '$ref' not stored: ${it.message}") }
            }
        }
        plugin.server.pluginManager.registerEvents(this, plugin)
        plugin.scheduler.async { refresh() }
    }

    @EventHandler
    fun onJoin(event: PlayerJoinEvent) {
        val id = event.player.uniqueId
        plugin.scheduler.async { loadOwner(id.toString()) }
    }

    private fun refresh() {
        if (!plugin.isEnabled) return
        val r = rows()
        if (r != null) {
            val now = System.currentTimeMillis()
            loadOwner(VariableStore.SERVER)
            // The database opens after the start: the players already online are read once it does.
            if (!loadedOnline) {
                loadedOnline = true
                Bukkit.getOnlinePlayers().map { it.uniqueId }.forEach { loadOwner(it.toString()) }
            }
            if (refreshes++ % PURGE_EVERY == PURGE_EVERY - 1) {
                runCatching { r.purge(now, clearedBefore = now - 24 * 60 * 60_000L) }
                    .onFailure { logger.warning("[Artisan] Expired Variables not purged: ${it.message}") }
            }
        } else if (!warnedNoDatabase && refreshes++ > 0) {
            warnedNoDatabase = true
            logger.info("[Artisan] No suite database: Variables live in memory and are lost at restart.")
        }
        store.prune()
        plugin.scheduler.asyncLater(REFRESH_TICKS) { refresh() }
    }

    private fun loadOwner(owner: String) {
        val r = rows() ?: return
        runCatching {
            store.load(r.of(owner, System.currentTimeMillis()).map { VariableStore.Stored(it.name, it.owner, it.value, it.expiresAt, it.updatedAt) })
        }.onFailure { logger.warning("[Artisan] Variables of $owner not read: ${it.message}") }
    }
}
