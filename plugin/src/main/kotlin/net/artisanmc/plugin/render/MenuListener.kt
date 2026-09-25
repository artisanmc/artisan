package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.*
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.inventory.InventoryClickEvent
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.inventory.InventoryDragEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.plugin.Plugin

class MenuListener(
    private val plugin: Plugin,
    private val sessions: MenuSessionStore,
    private val executor: ActionExecutor,
    private val playerSlots: PlayerSlotOverlayStore? = null,
) : Listener {

    @EventHandler
    fun onClick(event: InventoryClickEvent) {
        if (event.inventory.holder !is ArtisanMenuHolder) return
        event.isCancelled = true
        val player = event.whoClicked as? Player ?: return
        val session = sessions.get(player)
        val clickType = event.click.toIfzClickType()
        val handler = session?.activeClicks?.get(event.rawSlot)?.get(clickType)
        handler ?: return
        val slotCtx = session!!.ctx.copy(
            args = session.ctx.args + (session.slotArgs[event.rawSlot] ?: emptyMap()),
        )
        // Bukkit forbids opening/closing an inventory inside InventoryClickEvent:
        // the client then misses every slot whose item is unchanged from the
        // previous menu (decoration panes on the same slots). Next tick.
        plugin.server.scheduler.runTask(plugin, Runnable { executor.handle(handler, slotCtx) })
    }

    @EventHandler
    fun onDrag(event: InventoryDragEvent) {
        if (event.inventory.holder is ArtisanMenuHolder) event.isCancelled = true
    }

    @EventHandler
    fun onClose(event: InventoryCloseEvent) {
        if (event.inventory.holder is ArtisanMenuHolder) {
            val player = event.player as? Player ?: return
            sessions.remove(player)
            // Le client a écrit les items de l'overlay dans son propre inventaire
            // (les slots du bas d'une fenêtre pointent vers lui) : resynchro du
            // vrai contenu une fois la fenêtre fermée, sinon il les garde affichés.
            if (playerSlots?.release(player, event.inventory) == true) {
                plugin.server.scheduler.runTask(plugin, Runnable {
                    if (player.isOnline) player.updateInventory()
                })
            }
        }
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        playerSlots?.clear(event.player.uniqueId)
    }
}

private fun org.bukkit.event.inventory.ClickType.toIfzClickType(): ClickType? = when (this) {
    org.bukkit.event.inventory.ClickType.LEFT         -> ClickType.LEFT
    org.bukkit.event.inventory.ClickType.RIGHT        -> ClickType.RIGHT
    org.bukkit.event.inventory.ClickType.SHIFT_LEFT   -> ClickType.SHIFT_LEFT
    org.bukkit.event.inventory.ClickType.SHIFT_RIGHT  -> ClickType.SHIFT_RIGHT
    org.bukkit.event.inventory.ClickType.MIDDLE       -> ClickType.MIDDLE
    else                                               -> null
}
