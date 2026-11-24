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

    /**
     * [packId] loaded before [playerId] joined ([PreJoinPackLoads]): Paper fires no status event
     * in the configuration phase. Same rule as the event.
     */
    fun loadedBeforeJoin(playerId: UUID, packId: UUID) {
        if (delegated || packId in artisanPacks) loaded[playerId] = packId
    }

    @EventHandler
    fun onStatus(event: PlayerResourcePackStatusEvent) {
        status(event.player.uniqueId, event.id, event.status.name)
    }

    /**
     * One answer of [playerId]'s client about [packId]. A success marks it loaded; a refusal, a
     * failed download or reload, or a pack the client dropped unmarks it when it is the pack
     * that loaded, or one of Artisan's: the `textured` menus give way to the plain ones at the
     * next opening instead of drawing glyphs the client no longer has.
     */
    internal fun status(playerId: UUID, packId: UUID, status: String) {
        when (status) {
            "SUCCESSFULLY_LOADED" -> if (delegated || packId in artisanPacks) loaded[playerId] = packId
            in LOST -> if (loaded[playerId] == packId || packId in artisanPacks) loaded -= playerId
        }
    }

    private companion object {
        /** The statuses after which the client does not show the pack (names: older servers lack some). */
        val LOST = setOf("DECLINED", "FAILED_DOWNLOAD", "INVALID_URL", "FAILED_RELOAD", "DISCARDED")
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        loaded -= event.player.uniqueId
    }
}
