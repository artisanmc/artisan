package net.artisanmc.plugin.render

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

private val toClient: (org.bukkit.inventory.ItemStack) -> ItemStack = SpigotConversionUtil::fromBukkitItemStack

/**
 * Adaptateur PacketEvents du routage de [MenuWindows] : les paquets sortants
 * d'une fenêtre de menu reçoivent le contenu de ses [MenuSlots].
 *
 * `OPEN_WINDOW` capture l'id ; `WINDOW_ITEMS` (renvoyé après chaque clic annulé)
 * et `SET_SLOT` sont réécrits ; `SET_PLAYER_INVENTORY` (1.21.2+) aussi quand le
 * bas est `hidden`. Le serveur ne connaît pas ce contenu : chacune de ses
 * resynchros doit être rattrapée ici. `OPEN_WINDOW` porte aussi, pour tout
 * coffre, la texture vanilla en tête de titre ([VanillaGuiTitle]).
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
     * Capture l'id d'une fenêtre Artisan, puis rend à toute fenêtre de coffre sa
     * texture vanilla par le titre quand le pack l'a rendue transparente.
     */
    private fun onOpenWindow(event: PacketSendEvent, playerId: java.util.UUID) {
        val menuPending = windows.get(playerId)?.let { it.windowId < 0 } == true
        if (!menuPending && chestTexture == null) return
        val packet = WrapperPlayServerOpenWindow(event)
        if (menuPending) windows.onOpenWindow(playerId, packet.containerId)
        val rows = chestTexture?.rowsToDecorate(playerId, packet.containerId, packet.type) ?: return
        packet.title = VanillaGuiTitle.decorate(packet.title, rows)
        event.markForReEncode(true)
    }
}

/** Envois propres du contenu d'une fenêtre ; déjà réécrits, donc silencieux. */
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
