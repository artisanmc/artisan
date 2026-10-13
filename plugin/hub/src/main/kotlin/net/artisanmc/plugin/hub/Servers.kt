package net.artisanmc.plugin.hub

import java.util.concurrent.ConcurrentHashMap

/**
 * Les serveurs que l'éditeur atteint. Celui qui héberge le hub s'appelle [LOCAL] ; les autres
 * se relient par `/ws/plugin` et restent listés, hors ligne, après une déconnexion.
 */
class Servers(val local: EditorServer) {
    private val remote = ConcurrentHashMap<String, RemoteServer>()

    fun all(): List<EditorServer> = listOf(local) + remote.values.sortedBy { it.id }

    fun remote(id: String, create: (String) -> RemoteServer): RemoteServer = remote.computeIfAbsent(id, create)

    fun find(id: String?): EditorServer? = all().firstOrNull { it.id == id }

    /** Le serveur des routes `/api/v1/networks/:network/servers/:server/…`. */
    fun of(call: Call): EditorServer? =
        if (call.params["network"] != LOCAL) null else find(call.params["server"])

    /**
     * Un Project se nomme comme son dossier sur le serveur du hub (`shop`), et
     * `<serveur>.<dossier>` ailleurs (`survie2.shop`) : sans base de données, le nom du
     * dossier est la seule identité, et deux serveurs peuvent avoir le même.
     */
    fun project(id: String): ProjectRef? {
        val server = if ('.' in id) find(id.substringBefore('.'))?.takeIf { it.id != LOCAL } else local
        val folder = id.substringAfter('.')
        return if (server == null || folder.isEmpty()) null else ProjectRef(server, folder)
    }

    /** Le Project de `:project` ; une route qui nomme un serveur accepte aussi le seul nom du dossier. */
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
