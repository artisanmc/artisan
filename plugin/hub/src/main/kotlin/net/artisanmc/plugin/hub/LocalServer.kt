package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ServerLink

/**
 * Le serveur qui héberge l'éditeur, vu par ses routes. Ce que le backend apprenait au
 * `hello` (modules, sources de données, configuration) se lit ici à la demande.
 */
interface LocalServer {
    val link: ServerLink
    val label: String
    val minecraftVersion: String
    val pluginVersion: String
    fun modules(): List<Map<String, Any?>>
    fun dataSources(): List<Map<String, Any?>>
    fun models(): List<Map<String, Any?>>
    fun screens(): List<Map<String, Any?>>
    fun serverConfig(): Map<String, Any?>?
    /** Items de Nexo, Oraxen, ItemsAdder : `{id, label, category}`. */
    fun customItems(): List<Map<String, String>>
}
