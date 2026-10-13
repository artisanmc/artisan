package net.artisanmc.plugin.render

import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.ItemStack
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The open menu window per player: Bukkit anchor (empty), protocol window id and
 * contents ([MenuSlots]).
 *
 * The contents exist client-side only: the window's outgoing packets are rewritten
 * from the slots (pure routing here, adapter in [PacketEventsMenuPackets]). Nothing is
 * taken from the real inventory: a crash, a death or a disconnect with a menu open
 * loses nothing.
 */
class MenuWindows(private val sink: ClientSlotSink) {

    inner class Window(
        val player: Player,
        val anchor: Inventory,
        val slots: MenuSlots,
        /** The menu's `vanilla_texture`: false keeps the chest transparent (see VanillaGuiTitle). */
        val vanillaTexture: Boolean = true,
    ) : MenuSlots.Client {
        /** Protocol window id, captured from the open packet. -1 before. */
        @Volatile var windowId: Int = -1
            internal set

        /** Last stateId seen for the window, reused by our own sends. */
        @Volatile var stateId: Int = 0

        /** Items converted to the network listener's format, by rawSlot. */
        private val converted = ConcurrentHashMap<Int, Any>()

        @Suppress("UNCHECKED_CAST")
        internal fun <T : Any> view(rawSlot: Int, convert: (ItemStack) -> T, empty: T): T {
            val item = slots[rawSlot] ?: return empty
            return converted.getOrPut(rawSlot) { convert(item) } as T
        }

        override fun slotChanged(rawSlot: Int) {
            converted.remove(rawSlot)
            if (windowId >= 0 && slots.rewrites(rawSlot)) sink.sendSlot(player, windowId, rawSlot, slots[rawSlot])
        }

        override fun allChanged() {
            converted.clear()
            resend()
        }

        /**
         * Resends the whole window. After a cancelled click the client has already
         * predicted its effect (item taken, slot emptied) and the server does not always
         * resync through the menu window (player slots: window 0, or nothing).
         */
        fun resend() {
            if (windowId < 0) return
            val view = player.openInventory
            sink.sendAll(player, windowId, List(slots.size) { i -> if (slots.rewrites(i)) slots[i] else view.getItem(i) })
        }
    }

    private val windows = ConcurrentHashMap<UUID, Window>()

    /** Call BEFORE `openInventory`: the open packets are rewritten. */
    fun open(player: Player, anchor: Inventory, slots: MenuSlots, vanillaTexture: Boolean = true): Window {
        val window = Window(player, anchor, slots, vanillaTexture)
        slots.client = window
        windows.put(player.uniqueId, window)?.let { detach(it) }
        return window
    }

    fun get(playerId: UUID): Window? = windows[playerId]

    /**
     * Removes the window only if [anchor] is its own. Opening menu B from menu A sets
     * B then closes A: closing A must not take B with it. `true` if a window was removed.
     */
    fun release(player: Player, anchor: Inventory): Boolean {
        val window = windows[player.uniqueId] ?: return false
        if (window.anchor !== anchor || !windows.remove(player.uniqueId, window)) return false
        detach(window)
        return true
    }

    fun clear(playerId: UUID) {
        windows.remove(playerId)?.let { detach(it) }
    }

    private fun detach(window: Window) {
        if (window.slots.client === window) window.slots.client = null
    }

    // Outgoing packet routing (network threads).

    /** The first `OPEN_WINDOW` after [open] is the menu's. */
    fun onOpenWindow(playerId: UUID, windowId: Int) {
        val window = windows[playerId] ?: return
        if (window.windowId < 0) window.windowId = windowId
    }

    private fun openWindow(playerId: UUID, windowId: Int): Window? =
        windows[playerId]?.takeIf { it.windowId >= 0 && it.windowId == windowId }

    /** `WINDOW_ITEMS`: contents replaced, `null` = packet untouched. */
    fun <T : Any> rewriteWindowItems(playerId: UUID, windowId: Int, items: List<T>, convert: (ItemStack) -> T, empty: T): List<T>? {
        val window = openWindow(playerId, windowId) ?: return null
        return MenuSlots.rewriteContent(items, window.slots) { window.view(it, convert, empty) }
    }

    /** `SET_SLOT`: item replaced, `null` = packet untouched. */
    fun <T : Any> rewriteSetSlot(playerId: UUID, windowId: Int, rawSlot: Int, convert: (ItemStack) -> T, empty: T): T? {
        val window = openWindow(playerId, windowId) ?: return null
        return MenuSlots.rewriteSlot(rawSlot, window.slots) { window.view(it, convert, empty) }
    }

    /** `SET_PLAYER_INVENTORY` (1.21.2+), player index: rewritten if the bottom is `hidden`. */
    fun <T : Any> rewritePlayerInventory(playerId: UUID, index: Int, convert: (ItemStack) -> T, empty: T): T? {
        val window = windows[playerId]?.takeIf { it.windowId >= 0 } ?: return null
        val raw = MenuSlots.playerInventoryToRaw(index, window.slots.topSize) ?: return null
        return MenuSlots.rewriteSlot(raw, window.slots) { window.view(it, convert, empty) }
    }

    fun trackStateId(playerId: UUID, windowId: Int, stateId: Int) {
        openWindow(playerId, windowId)?.stateId = stateId
    }
}
