package net.artisanmc.plugin.render

import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.ItemStack
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Items affichés dans la partie joueur des menus Artisan ouverts, par joueur.
 *
 * Le serveur garde le vrai inventaire du joueur : seul ce que voit le client
 * est réécrit (par [PacketEventsPlayerSlots]). Rien n'est donc jamais retiré
 * de l'inventaire réel — un crash, une mort ou une déconnexion menu ouvert
 * ne peut pas faire perdre d'objet.
 *
 * Lu depuis les threads réseau : état immuable par overlay, map concurrente.
 */
class PlayerSlotOverlayStore {
    class Overlay(
        /** Inventaire du menu : identifie l'overlay à la fermeture. */
        val menu: Inventory,
        val topSize: Int,
        /** rawSlot (`topSize until topSize + 36`) → item affiché. */
        val items: Map<Int, ItemStack>,
    ) {
        /** Id de fenêtre protocole, capturé sur le paquet d'ouverture. -1 avant. */
        @Volatile var windowId: Int = -1

        /** Cache des items convertis au format du listener réseau. */
        @Volatile var converted: Any? = null
    }

    /** Config `menus.player-inventory-slots` ET PacketEvents présent. */
    @Volatile var active: Boolean = false

    private val overlays = ConcurrentHashMap<UUID, Overlay>()

    /** À poser AVANT `openInventory` : les paquets d'ouverture sont réécrits. */
    fun set(player: Player, menu: Inventory, items: Map<Int, ItemStack>) {
        overlays[player.uniqueId] = Overlay(menu, menu.size, items.mapValues { it.value.clone() })
    }

    fun get(playerId: UUID): Overlay? = overlays[playerId]

    /**
     * Retire l'overlay seulement s'il appartient à [menu]. Ouvrir un menu B
     * depuis un menu A pose l'overlay de B puis ferme A : la fermeture de A ne
     * doit pas emporter celui de B. `true` si un overlay a été retiré.
     */
    fun release(player: Player, menu: Inventory): Boolean {
        val overlay = overlays[player.uniqueId] ?: return false
        return overlay.menu === menu && overlays.remove(player.uniqueId, overlay)
    }

    fun clear(playerId: UUID) {
        overlays.remove(playerId)
    }
}
