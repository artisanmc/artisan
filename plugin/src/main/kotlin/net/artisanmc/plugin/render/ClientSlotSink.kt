package net.artisanmc.plugin.render

import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack

/** Envoie au client le contenu d'une fenêtre ouverte. Implémentation sans logique. */
interface ClientSlotSink {
    fun sendAll(player: Player, windowId: Int, items: List<ItemStack?>)
    fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: ItemStack?)

    object None : ClientSlotSink {
        override fun sendAll(player: Player, windowId: Int, items: List<ItemStack?>) {}
        override fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: ItemStack?) {}
    }
}
