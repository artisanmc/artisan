package net.artisanmc.plugin.render

import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.ItemStack
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Fenêtre de menu ouverte par joueur : ancre Bukkit (vide), id de fenêtre
 * protocole et contenu ([MenuSlots]).
 *
 * Le contenu n'existe que côté client : les paquets sortants de la fenêtre sont
 * réécrits depuis les slots (routage pur ici, adaptateur dans
 * [PacketEventsMenuPackets]). Rien n'est retiré de l'inventaire réel — un
 * crash, une mort ou une déconnexion menu ouvert ne fait rien perdre.
 */
class MenuWindows(private val sink: ClientSlotSink) {

    inner class Window(
        val player: Player,
        val anchor: Inventory,
        val slots: MenuSlots,
        /** `vanilla_texture` du menu : false garde le coffre transparent (cf. VanillaGuiTitle). */
        val vanillaTexture: Boolean = true,
    ) : MenuSlots.Client {
        /** Id de fenêtre protocole, capturé sur le paquet d'ouverture. -1 avant. */
        @Volatile var windowId: Int = -1
            internal set

        /** Dernier stateId vu pour la fenêtre, repris par les envois propres. */
        @Volatile var stateId: Int = 0

        /** Items convertis au format du listener réseau, par rawSlot. */
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
            if (windowId < 0) return
            val view = player.openInventory
            sink.sendAll(player, windowId, List(slots.size) { i -> if (slots.rewrites(i)) slots[i] else view.getItem(i) })
        }
    }

    private val windows = ConcurrentHashMap<UUID, Window>()

    /** À poser AVANT `openInventory` : les paquets d'ouverture sont réécrits. */
    fun open(player: Player, anchor: Inventory, slots: MenuSlots, vanillaTexture: Boolean = true): Window {
        val window = Window(player, anchor, slots, vanillaTexture)
        slots.client = window
        windows.put(player.uniqueId, window)?.let { detach(it) }
        return window
    }

    fun get(playerId: UUID): Window? = windows[playerId]

    /**
     * Retire la fenêtre seulement si [anchor] est la sienne. Ouvrir un menu B
     * depuis un menu A pose B puis ferme A : la fermeture de A ne doit pas
     * emporter B. `true` si une fenêtre a été retirée.
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

    // ── Routage des paquets sortants (threads réseau) ────────────────────────

    /** Premier `OPEN_WINDOW` après [open] = celui du menu. */
    fun onOpenWindow(playerId: UUID, windowId: Int) {
        val window = windows[playerId] ?: return
        if (window.windowId < 0) window.windowId = windowId
    }

    private fun openWindow(playerId: UUID, windowId: Int): Window? =
        windows[playerId]?.takeIf { it.windowId >= 0 && it.windowId == windowId }

    /** `WINDOW_ITEMS` : contenu remplacé, `null` = paquet intact. */
    fun <T : Any> rewriteWindowItems(playerId: UUID, windowId: Int, items: List<T>, convert: (ItemStack) -> T, empty: T): List<T>? {
        val window = openWindow(playerId, windowId) ?: return null
        return MenuSlots.rewriteContent(items, window.slots) { window.view(it, convert, empty) }
    }

    /** `SET_SLOT` : item remplacé, `null` = paquet intact. */
    fun <T : Any> rewriteSetSlot(playerId: UUID, windowId: Int, rawSlot: Int, convert: (ItemStack) -> T, empty: T): T? {
        val window = openWindow(playerId, windowId) ?: return null
        return MenuSlots.rewriteSlot(rawSlot, window.slots) { window.view(it, convert, empty) }
    }

    /** `SET_PLAYER_INVENTORY` (1.21.2+), index joueur : réécrit si le bas est `hidden`. */
    fun <T : Any> rewritePlayerInventory(playerId: UUID, index: Int, convert: (ItemStack) -> T, empty: T): T? {
        val window = windows[playerId]?.takeIf { it.windowId >= 0 } ?: return null
        val raw = MenuSlots.playerInventoryToRaw(index, window.slots.topSize) ?: return null
        return MenuSlots.rewriteSlot(raw, window.slots) { window.view(it, convert, empty) }
    }

    fun trackStateId(playerId: UUID, windowId: Int, stateId: Int) {
        openWindow(playerId, windowId)?.stateId = stateId
    }
}
