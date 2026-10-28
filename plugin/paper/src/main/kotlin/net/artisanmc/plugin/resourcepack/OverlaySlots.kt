package net.artisanmc.plugin.resourcepack

import net.artisanmc.modules.api.text.OverlayApi
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerQuitEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The slots of the screen Artisan owns (`OverlayApi.show`/`hide`): each player's layers, drawn
 * together. Every layer leaves the pen at the slot's centre, so the slot's line is the layers
 * one after the other, by ascending priority (then by first show). A slot that holds a layer is
 * sent again every [KEEP_ALIVE] ticks, on the player's thread: the client fades the action bar
 * after 3 s. [send] gets `""` when the last layer goes, which clears the slot.
 */
class OverlaySlots(
    private val scheduler: Scheduler,
    private val send: (UUID, OverlayApi.Slot, String) -> Unit,
) : Listener {

    private class Layer(val priority: Int, val order: Long, val content: String)

    private class Screen {
        val layers = ConcurrentHashMap<OverlayApi.Slot, MutableMap<String, Layer>>()
        /** The slots whose resend is scheduled. */
        val alive = ConcurrentHashMap.newKeySet<OverlayApi.Slot>()
    }

    private val screens = ConcurrentHashMap<UUID, Screen>()
    @Volatile private var counter = 0L

    fun show(player: UUID, slot: OverlayApi.Slot, layer: String, priority: Int, content: String) {
        val screen = screens.computeIfAbsent(player) { Screen() }
        val layers = screen.layers.computeIfAbsent(slot) { ConcurrentHashMap() }
        val order = layers[layer]?.order ?: synchronized(this) { counter++ }
        layers[layer] = Layer(priority, order, content)
        scheduler.player(player) { flush(player, slot) }
    }

    fun hide(player: UUID, slot: OverlayApi.Slot, layer: String) {
        val layers = screens[player]?.layers?.get(slot) ?: return
        if (layers.remove(layer) == null) return
        scheduler.player(player) { flush(player, slot) }
    }

    /** What [slot] shows for [player] now: its layers in drawing order, or `""`. */
    fun line(player: UUID, slot: OverlayApi.Slot): String =
        screens[player]?.layers?.get(slot)?.values
            ?.sortedWith(compareBy<Layer>({ it.priority }, { it.order }))
            ?.joinToString("") { it.content } ?: ""

    private fun flush(player: UUID, slot: OverlayApi.Slot) {
        val screen = screens[player] ?: return
        send(player, slot, line(player, slot))
        if (screen.layers[slot].isNullOrEmpty()) return
        if (screen.alive.add(slot)) keepAlive(player, slot)
    }

    private fun keepAlive(player: UUID, slot: OverlayApi.Slot) {
        scheduler.playerLater(player, KEEP_ALIVE) {
            val screen = screens[player] ?: return@playerLater
            if (screen.layers[slot].isNullOrEmpty()) {
                screen.alive.remove(slot)
                return@playerLater
            }
            send(player, slot, line(player, slot))
            keepAlive(player, slot)
        }
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        screens.remove(event.player.uniqueId)
    }

    companion object {
        const val KEEP_ALIVE = 20L
    }
}
