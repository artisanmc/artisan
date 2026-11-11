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
 * characters. Delegated, the pack is merged into a host plugin's pack (Nexo, Oraxen,
 * ItemsAdder), so any successful load counts; sent directly, only a pack Artisan sent.
 * Lives across `/artisan reload` (the pack manager is swapped). Read from network threads.
 */
class PackLoadTracker : Listener {
    /** The pack is merged into a host plugin's pack: any successful load counts. */
    @Volatile var delegated: Boolean = true

    private val artisanPacks = ConcurrentHashMap.newKeySet<UUID>()
    /** Player → id of the last pack that loaded for them (any pack when [delegated]). */
    private val loaded = ConcurrentHashMap<UUID, UUID>()

    fun pushed(packId: UUID) {
        artisanPacks += packId
    }

    fun hasLoaded(playerId: UUID): Boolean = loaded.containsKey(playerId)

    /** True once [packId], sent by Artisan, loaded for [playerId]: sending it again is useless. */
    fun hasLoaded(playerId: UUID, packId: UUID): Boolean = loaded[playerId] == packId

    @EventHandler
    fun onStatus(event: PlayerResourcePackStatusEvent) {
        if (event.status != PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED) return
        if (delegated || event.id in artisanPacks) loaded[event.player.uniqueId] = event.id
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        loaded -= event.player.uniqueId
    }
}
