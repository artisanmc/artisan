package net.artisanmc.plugin.hub

import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/**
 * The servers the editor reaches. The one hosting the hub is [LOCAL]; the others connect
 * through `/ws/plugin`. [known] lists them from `artisan_servers` with their last presence, so
 * an offline server stays listed across hub restarts; null without a database, where a
 * disconnected server stays listed until the hub restarts.
 */
class Servers(
    val local: EditorServer,
    private val known: () -> Map<String, Instant>? = { null },
    private val newRemote: (String) -> RemoteServer = { RemoteServer(it, publicUrl = { "" }) },
) {
    private val remote = ConcurrentHashMap<String, RemoteServer>()

    fun all(): List<EditorServer> {
        val known = known() ?: return listOf(local) + remote.values.sortedBy { it.id }
        known.keys.forEach(::remote)
        return listOf(local) + remote.values.filter { it.online || it.id in known }.sortedBy { it.id }
    }

    fun remote(id: String): RemoteServer = remote.computeIfAbsent(id, newRemote)

    fun lastSeen(id: String): Instant? = known()?.get(id)

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
