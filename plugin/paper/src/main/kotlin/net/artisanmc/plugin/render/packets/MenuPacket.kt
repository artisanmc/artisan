package net.artisanmc.plugin.render.packets

import net.kyori.adventure.text.Component
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack

/**
 * The four outgoing packets a menu window rewrites, read out of the server's own packet
 * objects. Items and titles stay in the server's format ([Any]): converting them is only
 * paid when a packet is actually rewritten.
 */
sealed interface MenuPacket {
    /** `OPEN_WINDOW`. [type] is the server's menu type, [typeId] its protocol id. */
    data class OpenScreen(val containerId: Int, val type: Any, val typeId: Int, val title: Any) : MenuPacket

    /** `WINDOW_ITEMS`, resent by the server after every cancelled click. */
    data class Content(val containerId: Int, val stateId: Int, val items: List<Any>, val carried: Any) : MenuPacket

    /** `SET_SLOT`. */
    data class Slot(val containerId: Int, val stateId: Int, val slot: Int, val item: Any) : MenuPacket

    /** `SET_PLAYER_INVENTORY` (1.21.2+): one slot of the player's inventory, by index. */
    data class PlayerInventory(val slot: Int, val item: Any) : MenuPacket
}

/**
 * Reads and builds the server's packet objects. The only part of the menu packets that
 * knows the server's classes ([NmsMenuPackets]); the rewriting itself ([MenuPacketRewriter])
 * does not.
 */
interface MenuPacketCodec {
    /** The menu packet in [packet], null for any other packet (the common case, kept cheap). */
    fun decode(packet: Any): MenuPacket?
    fun encode(packet: MenuPacket): Any

    /** A Bukkit item in the server's format. */
    fun item(stack: ItemStack): Any
    val emptyItem: Any

    fun title(raw: Any): Component
    fun rawTitle(title: Component): Any
}

/** Where a player's packets are written, past our own interception (so sent as is). */
fun interface SilentSender {
    fun send(player: Player, packet: Any)
}
