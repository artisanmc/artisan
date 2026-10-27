package net.artisanmc.plugin.hub

import org.eclipse.jetty.websocket.api.Callback
import org.eclipse.jetty.websocket.api.Session
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

/**
 * WebSocket `/ws/editor`: the server notifies open tabs (reload, rename). Each socket is the tab
 * of one editor session, by its public id ([Sessions.publicId]): who has the editor open here.
 */
class EditorChannel(private val logger: Logger?) {
    private val open = ConcurrentHashMap<Session, String>()
    private val reloadListeners = java.util.concurrent.CopyOnWriteArrayList<(server: String) -> Unit>()

    /** Called with the server id of each server whose `projects_reloaded` goes through here. */
    fun onReload(listener: (server: String) -> Unit) { reloadListeners += listener }

    fun broadcast(message: Map<String, Any?>) {
        val text = Call.mapper.writeValueAsString(message)
        open.keys.forEach { session -> if (session.isOpen) session.sendText(text, Callback.NOOP) }
    }

    /** An announcement from the server of id [server], in the shape the editor expects. */
    fun relay(event: Map<String, Any?>, server: String) {
        if (event["type"] != "projects_reloaded") return
        reloadListeners.forEach { it(server) }
        val projects = (event["projects"] as? List<*>).orEmpty().map { project ->
            val fields = project as? Map<*, *> ?: return@map project
            val folder = fields["id"] as? String ?: return@map project
            fields + ("id" to ProjectRef.id(server, folder))
        }
        broadcast(mapOf("type" to "projects_reloaded", "server_key_id" to server, "projects" to projects))
    }

    fun closeAll() {
        open.keys.forEach { runCatching { it.close() } }
        open.clear()
    }

    /** The public ids of the sessions with a tab open on this server. */
    fun online(): Set<String> = open.entries.filter { it.key.isOpen }.mapTo(HashSet()) { it.value }

    /** Closes the tabs of the session [id], which was just closed: the editor goes back to sign-in. */
    fun disconnect(id: String) {
        open.entries.filter { it.value == id }.forEach { (session, _) ->
            open.remove(session)
            runCatching { session.close(SESSION_CLOSED, "session_closed", Callback.NOOP) }
        }
    }

    fun endpoint(id: String = ""): Session.Listener = object : Session.Listener.AutoDemanding {
        private var session: Session? = null

        override fun onWebSocketOpen(session: Session) {
            this.session = session
            open[session] = id
        }

        // The editor's heartbeat: it keeps the socket under the idle timeout, nothing to answer.
        override fun onWebSocketText(message: String) = Unit

        override fun onWebSocketClose(statusCode: Int, reason: String?) {
            session?.let(open::remove)
        }

        override fun onWebSocketError(cause: Throwable) {
            logger?.fine("[Artisan] editor socket error: ${cause.message}")
            session?.let(open::remove)
        }
    }

    companion object {
        /** Close code of a tab whose session was closed (application range 4000-4999). */
        const val SESSION_CLOSED = 4401
    }
}
