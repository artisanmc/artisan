package net.artisanmc.plugin.resourcepack

import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Players whose client has loaded Artisan's resource pack. A title glyph from
 * `artisan:vanilla_gui` only renders for them — anyone else would see missing
 * characters. Lives across `/artisan reload` (the pack manager is swapped).
 * Read from network threads.
 */
class PackLoadTracker : Listener {
    /** The pack is merged into a host plugin's pack: any successful load counts. */
    @Volatile var delegated: Boolean = false

    private val artisanPacks = ConcurrentHashMap.newKeySet<UUID>()
    private val loaded = ConcurrentHashMap.newKeySet<UUID>()

    fun pushed(packId: UUID) {
        artisanPacks += packId
    }

    fun hasLoaded(playerId: UUID): Boolean = playerId in loaded

    @EventHandler
    fun onStatus(event: PlayerResourcePackStatusEvent) {
        if (event.status != PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED) return
        if (delegated || event.id in artisanPacks) loaded += event.player.uniqueId
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        loaded -= event.player.uniqueId
    }
}
