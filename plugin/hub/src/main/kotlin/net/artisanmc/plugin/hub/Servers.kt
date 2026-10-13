package net.artisanmc.plugin.hub

/** Les serveurs que l'éditeur atteint. Celui qui héberge le hub s'appelle [LOCAL]. */
class Servers(val local: EditorServer) {
    fun all(): List<EditorServer> = listOf(local)

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
    val id: String get() = id(server, folder)

    companion object {
        fun id(server: EditorServer, folder: String) = if (server.id == Servers.LOCAL) folder else "${server.id}.$folder"
    }
}
