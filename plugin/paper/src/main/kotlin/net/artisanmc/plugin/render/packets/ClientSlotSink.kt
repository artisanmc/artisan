package net.artisanmc.plugin.render.packets

import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack

/** Sends an open window's contents to the client. Implementations hold no logic. */
interface ClientSlotSink {
    fun sendAll(player: Player, windowId: Int, items: List<ItemStack?>)
    fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: ItemStack?)

    object None : ClientSlotSink {
        override fun sendAll(player: Player, windowId: Int, items: List<ItemStack?>) {}
        override fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: ItemStack?) {}
    }
}
