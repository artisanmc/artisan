package net.artisanmc.plugin.render.packets

import com.github.retrooper.packetevents.PacketEvents
import com.github.retrooper.packetevents.event.PacketListener
import com.github.retrooper.packetevents.event.PacketListenerPriority
import com.github.retrooper.packetevents.event.PacketSendEvent
import com.github.retrooper.packetevents.protocol.item.ItemStack
import com.github.retrooper.packetevents.protocol.packettype.PacketType
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerOpenWindow
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerSetPlayerInventory
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerSetSlot
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerWindowItems
import io.github.retrooper.packetevents.util.SpigotConversionUtil
import org.bukkit.entity.Player
import net.artisanmc.plugin.render.title.VanillaGuiTitle

private val toClient: (org.bukkit.inventory.ItemStack) -> ItemStack = SpigotConversionUtil::fromBukkitItemStack

/**
 * PacketEvents adapter for [MenuWindows] routing: a menu window's outgoing packets
 * receive the contents of its [MenuSlots].
 *
 * `OPEN_WINDOW` captures the id; `WINDOW_ITEMS` (resent after every cancelled click)
 * and `SET_SLOT` are rewritten; `SET_PLAYER_INVENTORY` (1.21.2+) too when the bottom is
 * `hidden`. The server does not know this content, so every resync it sends must be
 * caught here. For any chest, `OPEN_WINDOW` also carries the vanilla texture at the
 * start of the title ([VanillaGuiTitle]).
 */
class PacketEventsMenuPackets(
    private val windows: MenuWindows,
    private val chestTexture: VanillaGuiTitle.Rule? = null,
) : PacketListener {

    fun register() {
        PacketEvents.getAPI().eventManager.registerListener(this, PacketListenerPriority.HIGH)
    }

    override fun onPacketSend(event: PacketSendEvent) {
        val type = event.packetType
        if (type != PacketType.Play.Server.OPEN_WINDOW &&
            type != PacketType.Play.Server.WINDOW_ITEMS &&
            type != PacketType.Play.Server.SET_SLOT &&
            type != PacketType.Play.Server.SET_PLAYER_INVENTORY) return
        val playerId = event.user?.uuid ?: return
        if (type == PacketType.Play.Server.OPEN_WINDOW) {
            onOpenWindow(event, playerId)
            return
        }
        if (windows.get(playerId) == null) return

        when (type) {
            PacketType.Play.Server.WINDOW_ITEMS -> {
                val packet = WrapperPlayServerWindowItems(event)
                windows.trackStateId(playerId, packet.windowId, packet.stateId)
                packet.items = windows.rewriteWindowItems(playerId, packet.windowId, packet.items, toClient, ItemStack.EMPTY)
                    ?: return
                event.markForReEncode(true)
            }
            PacketType.Play.Server.SET_SLOT -> {
                val packet = WrapperPlayServerSetSlot(event)
                windows.trackStateId(playerId, packet.windowId, packet.stateId)
                packet.item = windows.rewriteSetSlot(playerId, packet.windowId, packet.slot, toClient, ItemStack.EMPTY)
                    ?: return
                event.markForReEncode(true)
            }
            PacketType.Play.Server.SET_PLAYER_INVENTORY -> {
                val packet = WrapperPlayServerSetPlayerInventory(event)
                packet.stack = windows.rewritePlayerInventory(playerId, packet.slot, toClient, ItemStack.EMPTY)
                    ?: return
                event.markForReEncode(true)
            }
        }
    }

    /**
     * Captures an Artisan window's id, then gives any chest window back its vanilla
     * texture through the title when the pack made it transparent.
     */
    private fun onOpenWindow(event: PacketSendEvent, playerId: java.util.UUID) {
        val menuPending = windows.get(playerId)?.let { it.windowId < 0 } == true
        if (!menuPending && chestTexture == null) return
        val packet = WrapperPlayServerOpenWindow(event)
        if (menuPending) windows.onOpenWindow(playerId, packet.containerId)
        val glyph = chestTexture?.glyphToDecorate(playerId, packet.containerId, packet.type) ?: return
        packet.title = VanillaGuiTitle.decorate(packet.title, glyph)
        event.markForReEncode(true)
    }
}

/** Our own sends of a window's contents; already rewritten, so silent. */
class PacketEventsSlotSink(private val stateId: (Player) -> Int) : ClientSlotSink {
    override fun sendAll(player: Player, windowId: Int, items: List<org.bukkit.inventory.ItemStack?>) {
        val packet = WrapperPlayServerWindowItems(
            windowId, stateId(player), items.map { it?.let(toClient) ?: ItemStack.EMPTY }, toClient(player.itemOnCursor),
        )
        PacketEvents.getAPI().playerManager.sendPacketSilently(player, packet)
    }

    override fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: org.bukkit.inventory.ItemStack?) {
        val packet = WrapperPlayServerSetSlot(windowId, stateId(player), rawSlot, item?.let(toClient) ?: ItemStack.EMPTY)
        PacketEvents.getAPI().playerManager.sendPacketSilently(player, packet)
    }
}
