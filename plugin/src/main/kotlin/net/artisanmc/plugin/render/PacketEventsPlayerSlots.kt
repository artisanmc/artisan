package net.artisanmc.plugin.render

import com.github.retrooper.packetevents.PacketEvents
import com.github.retrooper.packetevents.event.PacketListener
import com.github.retrooper.packetevents.event.PacketListenerPriority
import com.github.retrooper.packetevents.event.PacketSendEvent
import com.github.retrooper.packetevents.protocol.item.ItemStack
import com.github.retrooper.packetevents.protocol.packettype.PacketType
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerOpenWindow
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerSetSlot
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerWindowItems
import io.github.retrooper.packetevents.util.SpigotConversionUtil

/**
 * Réécrit, pour la fenêtre du menu Artisan ouvert, les slots de la partie
 * joueur dans les paquets sortants : items de l'overlay, vide ailleurs.
 *
 * Ne se charge que si le plugin PacketEvents est présent (soft-dep) : aucune
 * autre classe n'importe PacketEvents.
 *
 * Paquets couverts : `OPEN_WINDOW` (capture de l'id de fenêtre),
 * `WINDOW_ITEMS` (contenu complet, renvoyé après chaque clic annulé) et
 * `SET_SLOT` (un slot — ramassage d'objet, etc.). Le serveur ne sait rien de
 * l'overlay : c'est au listener de rattraper chacune de ses resynchros.
 */
class PacketEventsPlayerSlots(private val store: PlayerSlotOverlayStore) : PacketListener {

    fun register() {
        PacketEvents.getAPI().getEventManager().registerListener(this, PacketListenerPriority.HIGH)
    }

    override fun onPacketSend(event: PacketSendEvent) {
        val type = event.getPacketType()
        if (type != PacketType.Play.Server.OPEN_WINDOW &&
            type != PacketType.Play.Server.WINDOW_ITEMS &&
            type != PacketType.Play.Server.SET_SLOT) return
        if (!store.active) return
        val playerId = event.getUser()?.getUUID() ?: return
        val overlay = store.get(playerId) ?: return

        when (type) {
            PacketType.Play.Server.OPEN_WINDOW -> {
                // Premier OPEN_WINDOW après la pose de l'overlay = celui du menu.
                if (overlay.windowId < 0) overlay.windowId = WrapperPlayServerOpenWindow(event).getContainerId()
            }
            PacketType.Play.Server.WINDOW_ITEMS -> {
                val packet = WrapperPlayServerWindowItems(event)
                if (overlay.windowId < 0 || packet.getWindowId() != overlay.windowId) return
                val items = PlayerSlots.rewriteContent(packet.getItems(), overlay.topSize, converted(overlay), ItemStack.EMPTY)
                    ?: return
                packet.setItems(items)
                event.markForReEncode(true)
            }
            PacketType.Play.Server.SET_SLOT -> {
                val packet = WrapperPlayServerSetSlot(event)
                if (overlay.windowId < 0 || packet.getWindowId() != overlay.windowId) return
                val item = PlayerSlots.rewriteSlot(packet.getSlot(), overlay.topSize, converted(overlay), ItemStack.EMPTY)
                    ?: return
                packet.setItem(item)
                event.markForReEncode(true)
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun converted(overlay: PlayerSlotOverlayStore.Overlay): Map<Int, ItemStack> {
        (overlay.converted as? Map<Int, ItemStack>)?.let { return it }
        val map = overlay.items.mapValues { SpigotConversionUtil.fromBukkitItemStack(it.value) }
        overlay.converted = map
        return map
    }
}
