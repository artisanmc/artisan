package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.VIEW

/** The signed-in player as the editor's user, and the servers this hub serves. */
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
        // The hub's own server first, then the leaves by name: the editor opens the first one by default.
        router.on("GET", "/api/v1/servers", VIEW) { call -> call.json(mapOf("servers" to servers.all().map(::status))) }
    }

    /** Without [prefs], the tour stays closed: its progress would be kept nowhere. */
    private fun user(session: EditorSession, saved: PlayerPrefs.Prefs? = prefs?.read(session.playerId)) = mapOf(
        "id" to session.playerId.toString(),
        "name" to session.playerName,
        "editorLanguage" to saved?.editorLanguage,
        "theme" to saved?.theme,
        "editorTour" to if (saved == null) PlayerPrefs.Tour(0, true) else saved.editorTour,
        "permissions" to EditorPermissions.ALL.filter(session::can),
    )

    /** A server by its id, with what the editor shows of it: its name, presence and versions. */
    private fun status(server: EditorServer) = mapOf(
        "id" to server.id, "label" to server.label, "online" to server.online,
        "minecraftVersion" to server.minecraftVersion, "pluginVersion" to server.pluginVersion,
        "lastSeenAt" to servers.lastSeen(server.id)?.toString(), "updateRequired" to server.updateRequired,
    )
}
