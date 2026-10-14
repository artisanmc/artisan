package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Servers.Companion.LOCAL

/**
 * The account and network as the editor expects them: the signed-in player, a single
 * network named [LOCAL], and its servers.
 */
class AccountRoutes(private val servers: Servers, private val sessions: Sessions, private val prefs: PlayerPrefs?) {
    fun register(router: Router) {
        router.on("GET", "/api/v1/auth/me", VIEW) { it.json(mapOf("user" to user(it.session!!))) }
        router.on("PATCH", "/api/v1/auth/me", VIEW) { call ->
            val session = call.session!!
            if (prefs == null) return@on call.json(mapOf("user" to user(session)))
            val body = call.bytes(PlayerPrefs.MAX_BODY)?.let { runCatching { Call.mapper.readTree(it) }.getOrNull() }
                ?: return@on call.error(400, "invalid_body")
            val (saved, started) = try { prefs.update(session.playerId, body) } catch (e: PlayerPrefs.InvalidPrefs) { return@on call.error(422, e.code) }
            call.json(mapOf("user" to user(session, saved)) + (started?.let { mapOf("tourStarted" to it) } ?: emptyMap()))
        }
        router.on("POST", "/api/v1/auth/logout", VIEW) { call ->
            sessions.close(call.session!!.id)
            call.json(mapOf("ok" to true))
        }
        // `/ws/editor` authenticates with the session cookie: the ticket is only a required step.
        router.on("POST", "/api/v1/user/ws-ticket", VIEW) { it.json(mapOf("ticket" to "session")) }
        // One Network per hub: no id in the path.
        router.on("GET", "/api/v1/network", VIEW) { call ->
            call.json(mapOf("network" to network(), "projects" to emptyList<Any>(), "serverKeys" to servers.all().map(::serverKey)))
        }
        router.on("GET", "/api/v1/network/servers-status", VIEW) { call ->
            val all = servers.all()
            call.json(mapOf("servers" to all.map(::status), "online" to all.count { it.online }, "total" to all.size))
        }
    }

    /** Without [prefs], the tour stays closed: its progress would be kept nowhere. */
    private fun user(session: EditorSession, saved: PlayerPrefs.Prefs? = prefs?.read(session.playerId)) = mapOf(
        "id" to session.playerId.toString(),
        "email" to "",
        "name" to session.playerName,
        "avatarUrl" to null,
        "editorLanguage" to saved?.editorLanguage,
        "theme" to saved?.theme,
        "isAdmin" to false,
        "editorTour" to if (saved == null) PlayerPrefs.Tour(0, true) else saved.editorTour,
        "permissions" to EditorPermissions.ALL.filter(session::can),
    )

    private fun network() = mapOf(
        "id" to LOCAL, "name" to servers.local.label, "slug" to LOCAL, "tier" to "free",
        "subscriptionId" to null, "createdAt" to null, "updatedAt" to null,
    )

    private fun serverKey(server: EditorServer) = mapOf(
        "id" to server.uuid, "hash" to "", "label" to server.label, "slug" to server.uuid, "networkId" to LOCAL,
        "lastMcVersion" to server.minecraftVersion, "createdAt" to null,
        "resourcePackHash" to null, "resourcePackUpdatedAt" to null, "allowedIps" to emptyList<String>(), "online" to server.online,
    )

    private fun status(server: EditorServer) = mapOf(
        "id" to server.uuid, "label" to server.label, "online" to server.online, "lastMcVersion" to server.minecraftVersion,
        "lastSeenAt" to servers.lastSeen(server.id)?.toString(), "lastSeenIp" to null, "contentVersion" to 2, "pluginVersion" to server.pluginVersion,
        "pluginUpdateVersion" to null, "pluginUpdatePending" to false, "isCurrent" to true,
        "updateRequired" to server.updateRequired,
    )
}
