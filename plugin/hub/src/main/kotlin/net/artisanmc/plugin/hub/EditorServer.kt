package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ServerLink

/**
 * Un serveur que l'éditeur atteint, vu par ses routes. Ce que le backend apprenait au
 * `hello` (modules, sources de données, configuration) se lit ici à la demande.
 */
interface EditorServer {
    /** [Servers.LOCAL] pour le serveur qui héberge le hub. */
    val id: String
    val link: ServerLink
    val label: String
    val online: Boolean
    /** Sa version majeure du protocole n'est pas celle du hub : rien ne lui est envoyé. */
    val updateRequired: Boolean get() = false
    val minecraftVersion: String
    val pluginVersion: String
    fun modules(): List<Map<String, Any?>>
    fun dataSources(): List<Map<String, Any?>>
    fun models(): List<Map<String, Any?>>
    fun screens(): List<Map<String, Any?>>
    fun serverConfig(): Map<String, Any?>?
    /** Items de Nexo, Oraxen, ItemsAdder : `{id, label, category}`. */
    fun customItems(): List<Map<String, String>>
    /** Un pack servi par le hub sous [path] devient le pack du serveur. */
    fun applyResourcePack(hash: String, path: String)
}
