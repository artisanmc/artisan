package net.artisanmc.plugin.render.packets

import net.artisanmc.plugin.render.title.VanillaGuiTitle
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import java.util.UUID

/**
 * [MenuWindows] routing applied to outgoing packets: a menu window's packets receive the
 * contents of its [MenuSlots][net.artisanmc.plugin.session.MenuSlots].
 *
 * `OPEN_WINDOW` captures the id; `WINDOW_ITEMS` (resent after every cancelled click)
 * and `SET_SLOT` are rewritten; `SET_PLAYER_INVENTORY` (1.21.2+) too when the bottom is
 * `hidden`. The server does not know this content, so every resync it sends must be
 * caught here. For any chest, `OPEN_WINDOW` also carries the vanilla texture at the
 * start of the title ([VanillaGuiTitle]).
 *
 * Called on the player's network thread, for every packet sent to them.
 */
class MenuPacketRewriter(
    private val windows: MenuWindows,
    private val codec: MenuPacketCodec,
    private val chestTexture: VanillaGuiTitle.Rule? = null,
) {
    private val toClient: (ItemStack) -> Any = codec::item

    /** The packet to send instead of [packet]: [packet] itself when untouched. */
    fun rewrite(playerId: UUID, packet: Any): Any {
        val decoded = codec.decode(packet) ?: return packet
        if (decoded is MenuPacket.OpenScreen) return onOpenWindow(playerId, decoded)?.let(codec::encode) ?: packet
        if (windows.get(playerId) == null) return packet

        val rewritten: MenuPacket? = when (decoded) {
            is MenuPacket.Content -> {
                windows.trackStateId(playerId, decoded.containerId, decoded.stateId)
                windows.rewriteWindowItems(playerId, decoded.containerId, decoded.items, toClient, codec.emptyItem)
                    ?.let { decoded.copy(items = it) }
            }
            is MenuPacket.Slot -> {
                windows.trackStateId(playerId, decoded.containerId, decoded.stateId)
                windows.rewriteSetSlot(playerId, decoded.containerId, decoded.slot, toClient, codec.emptyItem)
                    ?.let { decoded.copy(item = it) }
            }
            is MenuPacket.PlayerInventory ->
                windows.rewritePlayerInventory(playerId, decoded.slot, toClient, codec.emptyItem)
                    ?.let { decoded.copy(item = it) }
            is MenuPacket.OpenScreen -> null
        }
        return rewritten?.let(codec::encode) ?: packet
    }

    /**
     * Captures an Artisan window's id and puts its composed title in the packet when the
     * server could not (Spigot), then gives any chest window back its vanilla texture
     * through the title when the pack made it transparent. Null = packet untouched.
     */
    private fun onOpenWindow(playerId: UUID, packet: MenuPacket.OpenScreen): MenuPacket.OpenScreen? {
        val pending = windows.get(playerId)?.takeIf { it.windowId < 0 }
        if (pending == null && chestTexture == null) return null
        var title = pending?.title
        if (pending != null) windows.onOpenWindow(playerId, packet.containerId)
        chestTexture?.glyphToDecorate(playerId, packet.containerId, packet.typeId)?.let { glyph ->
            title = VanillaGuiTitle.decorate(title ?: codec.title(packet.title), glyph)
        }
        return title?.let { packet.copy(title = codec.rawTitle(it)) }
    }
}

/** Our own sends of a window's contents; already rewritten, so silent. */
class PacketSlotSink(
    private val codec: MenuPacketCodec,
    private val sender: SilentSender,
    private val stateId: (Player) -> Int,
) : ClientSlotSink {
    override fun sendAll(player: Player, windowId: Int, items: List<ItemStack?>) {
        val packet = MenuPacket.Content(
            windowId, stateId(player), items.map { it?.let(codec::item) ?: codec.emptyItem }, codec.item(player.itemOnCursor),
        )
        sender.send(player, codec.encode(packet))
    }

    override fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: ItemStack?) {
        val packet = MenuPacket.Slot(windowId, stateId(player), rawSlot, item?.let(codec::item) ?: codec.emptyItem)
        sender.send(player, codec.encode(packet))
    }
}
