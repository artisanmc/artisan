package gg.interfaze.plugin.render

import gg.interfaze.plugin.engine.*
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.inventory.InventoryClickEvent
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.inventory.InventoryDragEvent

class MenuListener(
    private val sessions: MenuSessionStore,
    private val executor: ActionExecutor,
) : Listener {

    @EventHandler
    fun onClick(event: InventoryClickEvent) {
        val holderClass = event.inventory.holder?.javaClass?.simpleName ?: "null"
        if (event.inventory.holder !is InterfazeMenuHolder) {
            if (event.whoClicked.name != null) org.bukkit.Bukkit.getLogger().info("[IFZ-DEBUG] onClick ignored: holder=$holderClass")
            return
        }
        event.isCancelled = true
        val player = event.whoClicked as? Player ?: return
        val session = sessions.get(player)
        val clickType = event.click.toIfzClickType()
        val handler = session?.activeClicks?.get(event.rawSlot)?.get(clickType)
        org.bukkit.Bukkit.getLogger().info("[IFZ-DEBUG] onClick: player=${player.name} slot=${event.rawSlot} click=${event.click} type=$clickType session=${session?.menuId ?: "null"} handler=${handler != null} actions=${handler?.actions?.size ?: 0}")
        handler ?: return
        executor.handle(handler, session!!.ctx)
    }

    @EventHandler
    fun onDrag(event: InventoryDragEvent) {
        if (event.inventory.holder is InterfazeMenuHolder) event.isCancelled = true
    }

    @EventHandler
    fun onClose(event: InventoryCloseEvent) {
        if (event.inventory.holder is InterfazeMenuHolder) {
            sessions.remove(event.player as? Player ?: return)
        }
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
