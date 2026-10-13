package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player
import org.bukkit.event.Cancellable
import org.bukkit.event.HandlerList
import org.bukkit.event.inventory.ClickType
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.player.PlayerEvent

/*
 * Menu events: passed to the MenuApi listeners, then fired as Bukkit events, so a
 * plugin that is not an add-on can listen with a plain @EventHandler. Both run on
 * the player's thread, MenuApi listeners first. A menu opened over another fires
 * its open event, then the old window's close (reason OPEN_NEW); a repaint
 * (pagination, `set`) reopens the window the same way.
 */

/**
 * A menu is about to open for [getPlayer]. Cancelling opens nothing.
 * [args] = the context the menu opens with.
 */
@Beta
class MenuOpenEvent(player: Player, val menu: MenuRef, val args: Map<String, Any>) : PlayerEvent(player), Cancellable {
    private var cancelled = false
    override fun isCancelled() = cancelled
    override fun setCancelled(cancel: Boolean) {
        cancelled = cancel
    }
    override fun getHandlers(): HandlerList = HANDLERS

    companion object {
        private val HANDLERS = HandlerList()

        @JvmStatic
        fun getHandlerList(): HandlerList = HANDLERS
    }
}

/**
 * A click in an open menu, fired on the tick after the click, before its actions run.
 * [slot] is the raw slot (the menu's slots first, then the player's inventory);
 * [hasActions] says whether the menu defines actions for this slot and [click].
 * Cancelling skips those actions; the click itself never moves items.
 */
@Beta
class MenuClickEvent(
    player: Player,
    val menu: MenuRef,
    val slot: Int,
    val click: ClickType,
    val hasActions: Boolean,
) : PlayerEvent(player), Cancellable {
    private var cancelled = false
    override fun isCancelled() = cancelled
    override fun setCancelled(cancel: Boolean) {
        cancelled = cancel
    }
    override fun getHandlers(): HandlerList = HANDLERS

    companion object {
        private val HANDLERS = HandlerList()

        @JvmStatic
        fun getHandlerList(): HandlerList = HANDLERS
    }
}

/**
 * A menu window closed. Fired from Bukkit's close event: do not open an inventory
 * from the listener, schedule it (`api.scheduler`) instead.
 */
@Beta
class MenuCloseEvent(player: Player, val menu: MenuRef, val reason: InventoryCloseEvent.Reason) : PlayerEvent(player) {
    override fun getHandlers(): HandlerList = HANDLERS

    companion object {
        private val HANDLERS = HandlerList()

        @JvmStatic
        fun getHandlerList(): HandlerList = HANDLERS
    }
}
