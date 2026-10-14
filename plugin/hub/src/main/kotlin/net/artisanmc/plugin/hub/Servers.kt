package net.artisanmc.plugin.hub

import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/**
 * The servers the editor reaches, each by its server id (`plugins/Artisan/server-id`):
 * [local] hosts the hub, the others connect through `/ws/plugin`. [known] lists them from
 * `artisan_servers` with their name and last presence, so an offline server stays listed
 * across hub restarts; null without a database, where a disconnected server stays listed
 * until the hub restarts.
 */
class Servers(
    val local: EditorServer,
    private val known: () -> Map<String, Seen>? = { null },
    private val newRemote: (id: String, name: String) -> RemoteServer = { id, name -> RemoteServer(id, name, publicUrl = { "" }) },
) {
    /** A server of `artisan_servers`, keyed by its server id: its name and last presence. */
    data class Seen(val name: String, val lastSeen: Instant)

    private val remote = ConcurrentHashMap<String, RemoteServer>()

    /** The hub's own server first, then the others by name. */
    fun all(): List<EditorServer> {
        val known = known() ?: return listOf(local) + remote.values.sortedBy { it.label }
        known.forEach { (id, seen) -> remote(id, seen.name) }
        return listOf(local) + remote.values.filter { it.online || it.id in known }.sortedBy { it.label }
    }

    /** The server of [id], created on its first sight; [name] is its label until its `hello` says otherwise. */
    fun remote(id: String, name: String = ""): RemoteServer =
        remote.computeIfAbsent(id) { newRemote(it, name) }.also { if (name.isNotEmpty()) it.name = name }

    fun lastSeen(id: String): Instant? = known()?.get(id)?.lastSeen

    fun find(id: String?): EditorServer? = id?.takeIf { it.isNotEmpty() }?.let { s -> all().firstOrNull { it.id == s } }

    /** The server of `/api/v1/servers/:server/…` routes. */
    fun of(call: Call): EditorServer? = find(call.params["server"])

    /**
     * A Project is named `<server id>.<folder>` (`f3a1….shop`) on every server, the hub's own
     * included: the folder name alone names nothing, two servers may have the same one.
     */
    fun project(id: String): ProjectRef? {
        val server = find(id.substringBefore('.', "")) ?: return null
        return ref(server, id.substringAfter('.'))
    }

    /** The Project of `:project`; a route naming a server also accepts the bare folder name. */
    fun projectOf(call: Call): ProjectRef? {
        val id = call.params["project"] ?: return null
        if (!call.params.containsKey("server")) return project(id)
        val server = of(call) ?: return null
        return ref(server, id.removePrefix("${server.id}."))
    }

    private fun ref(server: EditorServer, folder: String) =
        if ('.' in folder || folder.isEmpty()) null else ProjectRef(server, folder)
}

class ProjectRef(val server: EditorServer, val folder: String) {
    val id: String get() = id(server.id, folder)

    companion object {
        fun id(server: String, folder: String) = "$server.$folder"
    }
}
