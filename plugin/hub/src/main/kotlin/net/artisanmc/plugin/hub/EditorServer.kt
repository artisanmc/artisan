package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ProtocolVersion
import net.artisanmc.plugin.protocol.ServerLink

/**
 * A server the editor reaches, as seen by its routes. What a server announces
 * (modules, data sources, configuration) is read here on demand.
 */
interface EditorServer {
    /** [Servers.LOCAL] for the server hosting the hub. */
    val id: String
    val link: ServerLink
    val label: String
    val online: Boolean
    /** Its protocol major differs from the hub's: nothing is sent to it. */
    val updateRequired: Boolean get() = false
    /** A minor older than the hub's ignores the messages added since. */
    val protocolVersion: String get() = ProtocolVersion.CURRENT
    val minecraftVersion: String
    val pluginVersion: String
    fun modules(): List<Map<String, Any?>>
    fun dataSources(): List<Map<String, Any?>>
    fun models(): List<Map<String, Any?>>
    fun screens(): List<Map<String, Any?>>
    fun serverConfig(): Map<String, Any?>?
    /** Nexo, Oraxen, ItemsAdder items: `{id, label, category}`. */
    fun customItems(): List<Map<String, String>>
    /** A pack served by the hub under [path] becomes the server's pack. */
    fun applyResourcePack(hash: String, path: String)
}
