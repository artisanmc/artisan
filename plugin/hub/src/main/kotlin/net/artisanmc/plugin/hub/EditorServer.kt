package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ProtocolVersion
import net.artisanmc.plugin.protocol.ServerLink

/**
 * A server the editor reaches, as seen by its routes. What a server announces
 * (modules, data sources, configuration) is read here on demand.
 */
interface EditorServer {
    /**
     * Its server id (`plugins/Artisan/server-id`), the hub's own included: what routes, the
     * editor's URLs, `server_key_id` and Project ids (`<server id>.<folder>`) name it by.
     */
    val id: String
    val link: ServerLink
    /** Its name in the network: an attribute, shown in the server list. */
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
    /** Registered actions, core and modules': `{name, args, primary?, module_id?}` (ADR extensible-document-kinds). */
    fun actions(): List<Map<String, Any?>> = emptyList()
    /** Registered Document kinds, core and modules': `{kind, dir, schema_versions, id_prefix?, module_id?}` (W6). */
    fun documentKinds(): List<Map<String, Any?>> = emptyList()
    fun serverConfig(): Map<String, Any?>?
    /** Nexo, Oraxen, ItemsAdder items: `{id, label, category}`. */
    fun customItems(): List<Map<String, String>>
    /** A pack served by the hub under [path] becomes the server's pack. */
    fun applyResourcePack(hash: String, path: String)
}
