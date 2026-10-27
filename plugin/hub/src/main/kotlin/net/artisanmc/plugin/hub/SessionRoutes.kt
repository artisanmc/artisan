package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.CONFIG

/**
 * The open editor sessions of every server of the database, for those who configure the editor:
 * who, from which server, last active when, with a tab open here or not; each one closable.
 */
class SessionRoutes(
    private val servers: Servers,
    private val sessions: Sessions,
    /** The public ids of the sessions with an editor tab open on this server ([EditorChannel.online]). */
    private val online: () -> Set<String>,
) {
    fun register(router: Router) {
        router.on("GET", PATH, CONFIG) { call ->
            val open = online()
            val current = sessions.publicId(call.session!!.id)
            val labels = servers.all().associate { it.id to it.label }
            call.json(mapOf("sessions" to sessions.list().map { json(it, labels[it.origin], it.id in open, it.id == current) }))
        }
        router.on("DELETE", "$PATH/:session", CONFIG) { call ->
            val id = call.params.getValue("session")
            // The full id only: a prefix is for a command typed by hand.
            if (id.length == ID_LENGTH && sessions.revoke(id)) call.json(mapOf("ok" to true))
            else call.error(404, "not_found")
        }
    }

    private fun json(session: ActiveSession, label: String?, online: Boolean, current: Boolean) = mapOf(
        "id" to session.id,
        "playerId" to session.playerId.toString(),
        "playerName" to session.playerName,
        "permissions" to EditorPermissions.ALL.filter { it in session.permissions },
        "serverId" to session.origin.ifEmpty { null },
        "serverLabel" to label,
        "createdAt" to session.createdAt?.toString(),
        "lastActiveAt" to session.lastActiveAt.toString(),
        "expiresAt" to session.expiresAt.toString(),
        "online" to online,
        "current" to current,
    )

    companion object {
        const val PATH = "/api/v1/editor-sessions"
        /** A SHA-256 in hex. */
        const val ID_LENGTH = 64
    }
}
