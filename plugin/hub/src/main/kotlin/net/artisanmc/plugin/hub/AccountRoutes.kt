package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Servers.Companion.LOCAL

/**
 * Le compte et le réseau tels que l'éditeur les attend du backend : le joueur connecté,
 * un réseau unique nommé [LOCAL], et ses serveurs.
 */
class AccountRoutes(private val servers: Servers, private val sessions: Sessions) {
    fun register(router: Router) {
        router.on("GET", "/api/v1/auth/me", VIEW) { it.json(mapOf("user" to user(it.session!!))) }
        // Le tour guidé et la langue sont gardés par le navigateur : rien à enregistrer ici.
        router.on("PATCH", "/api/v1/auth/me", VIEW) { it.json(mapOf("user" to user(it.session!!))) }
        router.on("POST", "/api/v1/auth/logout", VIEW) { call ->
            sessions.close(call.session!!.id)
            call.json(mapOf("ok" to true))
        }
        // `/ws/editor` s'authentifie par le cookie de session : le ticket n'est qu'un passage obligé.
        router.on("POST", "/api/v1/user/ws-ticket", VIEW) { it.json(mapOf("ticket" to "session")) }
        router.on("GET", "/api/v1/networks", VIEW) { it.json(mapOf("networks" to listOf(network()))) }
        router.on("GET", "/api/v1/networks/:network", VIEW) { call ->
            if (call.params["network"] != LOCAL) return@on call.error(404, "not_found")
            call.json(mapOf("network" to network(), "projects" to emptyList<Any>(), "serverKeys" to servers.all().map(::serverKey)))
        }
        router.on("GET", "/api/v1/networks/:network/servers-status", VIEW) { call ->
            if (call.params["network"] != LOCAL) return@on call.error(404, "not_found")
            val all = servers.all()
            call.json(mapOf("servers" to all.map(::status), "online" to all.count { it.online }, "total" to all.size))
        }
    }

    private fun user(session: EditorSession) = mapOf(
        "id" to session.playerId.toString(),
        "email" to "",
        "name" to session.playerName,
        "avatarUrl" to null,
        "editorLanguage" to null,
        "theme" to null,
        "isAdmin" to false,
        "editorTour" to mapOf("step" to 0, "completed" to true),
        "permissions" to EditorPermissions.ALL.filter(session::can),
    )

    private fun network() = mapOf(
        "id" to LOCAL, "name" to servers.local.label, "slug" to LOCAL, "tier" to "free",
        "subscriptionId" to null, "createdAt" to null, "updatedAt" to null,
    )

    private fun serverKey(server: EditorServer) = mapOf(
        "id" to server.id, "hash" to "", "label" to server.label, "slug" to server.id, "networkId" to LOCAL,
        "lastMcVersion" to server.minecraftVersion, "editorAccessMode" to "invitation", "createdAt" to null,
        "resourcePackHash" to null, "resourcePackUpdatedAt" to null, "allowedIps" to emptyList<String>(), "online" to server.online,
    )

    private fun status(server: EditorServer) = mapOf(
        "id" to server.id, "label" to server.label, "online" to server.online, "lastMcVersion" to server.minecraftVersion,
        "lastSeenAt" to null, "lastSeenIp" to null, "contentVersion" to 2, "pluginVersion" to server.pluginVersion,
        "pluginUpdateVersion" to null, "pluginUpdatePending" to false, "isCurrent" to true,
    )
}
