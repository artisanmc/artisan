package net.artisanmc.plugin.hub

import java.util.concurrent.ConcurrentHashMap

/**
 * The servers the editor reaches. The one hosting the hub is [LOCAL]; the others connect
 * through `/ws/plugin` and stay listed, offline, after a disconnect.
 */
class Servers(val local: EditorServer) {
    private val remote = ConcurrentHashMap<String, RemoteServer>()

    fun all(): List<EditorServer> = listOf(local) + remote.values.sortedBy { it.id }

    fun remote(id: String, create: (String) -> RemoteServer): RemoteServer = remote.computeIfAbsent(id, create)

    fun find(id: String?): EditorServer? = all().firstOrNull { it.id == id }

    /** The server of `/api/v1/networks/:network/servers/:server/…` routes. */
    fun of(call: Call): EditorServer? =
        if (call.params["network"] != LOCAL) null else find(call.params["server"])

    /**
     * A Project is named after its folder on the hub's server (`shop`), and
     * `<server>.<folder>` elsewhere (`survie2.shop`): without a database the folder name
     * is the only identity, and two servers may have the same one.
     */
    fun project(id: String): ProjectRef? {
        val server = if ('.' in id) find(id.substringBefore('.'))?.takeIf { it.id != LOCAL } else local
        val folder = id.substringAfter('.')
        return if (server == null || folder.isEmpty()) null else ProjectRef(server, folder)
    }

    /** The Project of `:project`; a route naming a server also accepts the bare folder name. */
    fun projectOf(call: Call): ProjectRef? {
        val id = call.params["project"] ?: return null
        if (!call.params.containsKey("server")) return project(id)
        val server = of(call) ?: return null
        val folder = id.removePrefix("${server.id}.")
        return if ('.' in folder || folder.isEmpty()) null else ProjectRef(server, folder)
    }

    companion object {
        const val LOCAL = "local"
    }
}

class ProjectRef(val server: EditorServer, val folder: String) {
    val id: String get() = id(server.id, folder)

    companion object {
        fun id(server: String, folder: String) = if (server == Servers.LOCAL) folder else "$server.$folder"
    }
}
