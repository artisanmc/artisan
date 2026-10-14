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
 * characters. The pack is always merged into a host plugin's pack (Nexo, Oraxen,
 * ItemsAdder), so any successful load counts. Lives across `/artisan reload`.
 * Read from network threads.
 */
class PackLoadTracker : Listener {
    private val loaded = ConcurrentHashMap.newKeySet<UUID>()

    fun hasLoaded(playerId: UUID): Boolean = playerId in loaded

    @EventHandler
    fun onStatus(event: PlayerResourcePackStatusEvent) {
        if (event.status == PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED) loaded += event.player.uniqueId
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        loaded -= event.player.uniqueId
    }
}
