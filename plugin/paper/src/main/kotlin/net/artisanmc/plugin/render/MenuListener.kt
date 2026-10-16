package net.artisanmc.plugin.render

import net.artisanmc.modules.api.menu.MenuClickEvent
import net.artisanmc.modules.api.menu.MenuCloseEvent
import net.artisanmc.plugin.engine.*
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.inventory.InventoryClickEvent
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.inventory.InventoryDragEvent
import org.bukkit.event.player.PlayerQuitEvent
import net.artisanmc.plugin.scheduling.schedulerFor
import org.bukkit.plugin.Plugin

class MenuListener(
    private val plugin: Plugin,
    private val sessions: MenuSessionStore,
    private val executor: ActionExecutor,
    private val windows: MenuWindows? = null,
    private val history: NavigationHistoryStore? = null,
    private val events: MenuEventDispatcher? = null,
    private val resync: (Player) -> Unit = { it.updateInventory() },
) : Listener {
    private val scheduler = schedulerFor(plugin)

    @EventHandler
    fun onClick(event: InventoryClickEvent) {
        if (event.inventory.holder !is ArtisanMenuHolder) return
        event.isCancelled = true
        val player = event.whoClicked as? Player ?: return
        resendNextTick(player, event.inventory)
        val session = sessions.get(player) ?: return
        val slot = event.rawSlot
        val click = event.click
        val handler = session.activeClicks[slot]?.get(click.toIfzClickType())
        if (handler == null && events == null) return
        val slotCtx = session.ctx.copy(
            args = session.ctx.args + (session.slotArgs[slot] ?: emptyMap()),
        )
        // Bukkit forbids opening/closing an inventory inside InventoryClickEvent:
        // the client then misses every slot whose item is unchanged from the
        // previous menu (decoration panes on the same slots). Next tick.
        scheduler.player(player.uniqueId) {
            val proceed = events?.click(MenuClickEvent(player, session.ref, slot, click, handler != null)) ?: true
            if (proceed && handler != null) executor.handle(handler, slotCtx)
        }
    }

    @EventHandler
    fun onDrag(event: InventoryDragEvent) {
        if (event.inventory.holder !is ArtisanMenuHolder) return
        event.isCancelled = true
        (event.whoClicked as? Player)?.let { resendNextTick(it, event.inventory) }
    }

    /** The content exists client-side only, so undoing the client's prediction is on us. */
    private fun resendNextTick(player: Player, anchor: org.bukkit.inventory.Inventory) {
        val window = windows?.get(player.uniqueId)?.takeIf { it.anchor === anchor } ?: return
        scheduler.player(player.uniqueId) {
            if (windows.get(player.uniqueId) === window) window.resend()
        }
    }

    @EventHandler
    fun onClose(event: InventoryCloseEvent) {
        if (event.inventory.holder is ArtisanMenuHolder) {
            val player = event.player as? Player ?: return
            val session = sessions.get(player)
            sessions.remove(player)
            if (session != null) events?.close(MenuCloseEvent(player, session.ref, event.reason))
            val goBack = session?.escapeGoesBack == true && event.reason == InventoryCloseEvent.Reason.PLAYER
            endNavigationIfClosed(player, goBack, session?.ctx)
            // The client showed the menu's content in its own inventory (a window's
            // bottom slots point to it): resync the real content once the window is
            // closed. Only if it is this anchor: opening B from A closes A after B is set.
            if (windows?.release(player, event.inventory) == true) {
                scheduler.player(player.uniqueId) { resync(player) }
            }
        }
    }

    /**
     * Closed without opening another screen (ESC, `close_menu`): the navigation is over,
     * and so is the history; otherwise a later `open_menu` would push a closed menu and
     * going back would reopen it. Checked on the next tick: opening B from A (or a
     * dialog) also closes A, but another screen is then shown.
     * [goBack] (ESC + the project's `escape_goes_back`): reopens the previous screen if
     * there is one, like `open_previous_menu`.
     */
    private fun endNavigationIfClosed(player: Player, goBack: Boolean, ctx: ExecutionContext?) {
        val store = history ?: return
        val shown = store.current(player)?.takeIf { it.kind == NavigationEntry.Kind.MENU } ?: return
        scheduler.player(player.uniqueId) {
            if (store.current(player) !== shown) return@player
            if (player.openInventory.topInventory?.holder is ArtisanMenuHolder) return@player
            if (goBack && ctx != null && store.hasPrevious(player)) executor.executeSteps(listOf(Step.ActionStep("open_previous_menu")), ctx)
            else store.clear(player)
        }
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        windows?.clear(event.player.uniqueId)
        sessions.remove(event.player)
        history?.clear(event.player)
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
