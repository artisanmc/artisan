package net.artisanmc.plugin.render

import org.bukkit.inventory.ItemStack
import java.util.concurrent.atomic.AtomicReferenceArray

/** Réglage `player_inventory` d'un menu : ce que montre le bas de la fenêtre. */
enum class PlayerInventoryMode {
    /** Le vrai inventaire du joueur, non modifiable. Positions `≥ size` ignorées. */
    VISIBLE,
    /** Uniquement les boutons du menu, vide ailleurs. */
    HIDDEN;

    companion object {
        fun parse(raw: String?): PlayerInventoryMode = if (raw.equals("hidden", ignoreCase = true)) HIDDEN else VISIBLE
    }
}

/**
 * Nature d'un slot. `DISPLAY` : contenu envoyé par paquets, ancre vide, clics
 * annulés. `INPUT` (slot de dépôt) : objet réel dans l'ancre, paquets laissés
 * intacts. Seul `DISPLAY` est produit aujourd'hui ; le filtrage existe déjà
 * pour qu'ajouter `INPUT` ne demande pas de refonte.
 */
enum class SlotKind { DISPLAY, INPUT }

/**
 * Contenu d'une fenêtre de menu, adressé par rawSlot du protocole :
 * `0 until topSize` le menu, `topSize until topSize + 27` l'inventaire
 * principal, puis les 9 de la barre rapide.
 *
 * Seul point d'écriture du contenu d'un menu : l'ancre Bukkit reste vide, le
 * client reçoit ces items par paquets ([MenuWindows]). Menu ouvert, chaque
 * écriture est poussée au client.
 *
 * Écrit sur le thread principal, lu depuis les threads réseau.
 */
class MenuSlots(val topSize: Int, val playerInventory: PlayerInventoryMode = PlayerInventoryMode.VISIBLE) {
    val size = topSize + PLAYER_SLOTS

    /** Borne (exclue) des positions qu'un menu peut adresser. */
    val slotLimit = if (playerInventory == PlayerInventoryMode.HIDDEN) size else topSize

    private val items = AtomicReferenceArray<ItemStack?>(size)
    private val kinds = AtomicReferenceArray<SlotKind>(Array(size) { SlotKind.DISPLAY })

    /** Fenêtre ouverte qui reçoit les écritures, posée par [MenuWindows]. */
    @Volatile internal var client: Client? = null

    internal interface Client {
        fun slotChanged(rawSlot: Int)
        fun allChanged()
    }

    fun addressable(rawSlot: Int): Boolean = rawSlot in 0 until slotLimit

    /** Le contenu client de ce slot vient-il de ce menu (et non du serveur) ? */
    fun rewrites(rawSlot: Int): Boolean = addressable(rawSlot) && kinds[rawSlot] == SlotKind.DISPLAY

    fun kind(rawSlot: Int): SlotKind = kinds[rawSlot]

    fun setKind(rawSlot: Int, kind: SlotKind) {
        kinds[rawSlot] = kind
    }

    operator fun get(rawSlot: Int): ItemStack? = if (addressable(rawSlot)) items[rawSlot] else null

    /** Hors [addressable] (bas d'un menu `visible`) : ignoré. */
    operator fun set(rawSlot: Int, item: ItemStack?) {
        if (!addressable(rawSlot)) return
        items[rawSlot] = item?.takeUnless { it.type.isAir }
        client?.slotChanged(rawSlot)
    }

    fun clear() {
        for (i in 0 until size) items[i] = null
        client?.allChanged()
    }

    /** Même géométrie que [other] : la même fenêtre peut afficher son contenu. */
    fun sameShape(other: MenuSlots): Boolean = topSize == other.topSize && playerInventory == other.playerInventory

    /** Reprend tout le contenu de [other] (même forme) et renvoie la fenêtre en un paquet. */
    fun replaceWith(other: MenuSlots) {
        require(sameShape(other)) { "slot shapes differ" }
        for (i in 0 until size) {
            items[i] = other.items[i]
            kinds[i] = other.kinds[i]
        }
        client?.allChanged()
    }

    companion object {
        const val PLAYER_SLOTS = 36

        /**
         * Index d'inventaire joueur (`SET_PLAYER_INVENTORY`, 1.21.2+) vers
         * rawSlot : `0..8` barre rapide, `9..35` principal ; le reste (armure,
         * seconde main) n'apparaît pas dans la fenêtre.
         */
        fun playerInventoryToRaw(index: Int, topSize: Int): Int? = when (index) {
            in 0..8 -> topSize + 27 + index
            in 9..35 -> topSize + index - 9
            else -> null
        }

        /**
         * Contenu complet d'une fenêtre (`WINDOW_ITEMS`) : chaque slot réécrit
         * par [view], les autres intacts. `null` si la taille ne correspond pas.
         */
        fun <T> rewriteContent(items: List<T>, slots: MenuSlots, view: (Int) -> T): List<T>? {
            if (items.size != slots.size) return null
            return items.mapIndexed { i, item -> if (slots.rewrites(i)) view(i) else item }
        }

        /** Un slot (`SET_SLOT`) : ce que le client doit voir, `null` = paquet intact. */
        fun <T> rewriteSlot(rawSlot: Int, slots: MenuSlots, view: (Int) -> T): T? =
            if (slots.rewrites(rawSlot)) view(rawSlot) else null
    }
}
