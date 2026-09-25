package net.artisanmc.plugin.render

/**
 * Partie joueur d'une fenêtre de menu : adressage et réécriture de ce que le
 * client affiche. Pur (ni Bukkit ni PacketEvents) pour rester testable hors
 * serveur ; [PacketEventsPlayerSlots] l'applique aux paquets.
 *
 * Numérotation protocole d'une fenêtre de conteneur (= `rawSlot` Bukkit) :
 * `0 until topSize` le menu, puis 27 slots d'inventaire principal, puis les
 * 9 de la barre rapide. Une position de menu `≥ topSize` désigne donc
 * directement un slot de la partie joueur.
 */
object PlayerSlots {
    const val COUNT = 36

    fun isPlayerSlot(rawSlot: Int, topSize: Int): Boolean =
        rawSlot >= topSize && rawSlot < topSize + COUNT

    /**
     * Contenu complet d'une fenêtre (paquet `WINDOW_ITEMS`) : le menu intact,
     * la partie joueur remplacée par [overlay] (vide hors overlay). `null` si
     * la taille ne correspond pas à une fenêtre de [topSize] slots.
     */
    fun <T> rewriteContent(items: List<T>, topSize: Int, overlay: Map<Int, T>, empty: T): List<T>? {
        if (items.size != topSize + COUNT) return null
        return items.mapIndexed { i, item -> if (i < topSize) item else overlay[i] ?: empty }
    }

    /**
     * Un slot (paquet `SET_SLOT`) : ce que le client doit voir, ou `null` si
     * le slot n'appartient pas à la partie joueur (paquet laissé intact).
     */
    fun <T> rewriteSlot(slot: Int, topSize: Int, overlay: Map<Int, T>, empty: T): T? =
        if (isPlayerSlot(slot, topSize)) overlay[slot] ?: empty else null
}
