package net.artisanmc.plugin.hub

import org.eclipse.jetty.websocket.api.Callback
import org.eclipse.jetty.websocket.api.Session
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

/** WebSocket `/ws/editor`: the server notifies open tabs (reload, rename). */
class EditorChannel(private val logger: Logger?) {
    private val open = ConcurrentHashMap.newKeySet<Session>()

    fun broadcast(message: Map<String, Any?>) {
        val text = Call.mapper.writeValueAsString(message)
        open.forEach { session -> if (session.isOpen) session.sendText(text, Callback.NOOP) }
    }

    /** An announcement from a server, in the shape the editor expects. */
    fun relay(event: Map<String, Any?>, server: String = Servers.LOCAL, serverUuid: String = "") {
        if (event["type"] != "projects_reloaded") return
        val projects = (event["projects"] as? List<*>).orEmpty().map { project ->
            val fields = project as? Map<*, *> ?: return@map project
            val folder = fields["id"] as? String ?: return@map project
            fields + ("id" to ProjectRef.id(server, folder))
        }
        broadcast(mapOf("type" to "projects_reloaded", "server_key_id" to serverUuid.ifEmpty { server }, "projects" to projects))
    }

    fun closeAll() {
        open.forEach { runCatching { it.close() } }
        open.clear()
    }

    fun endpoint(): Session.Listener = object : Session.Listener.AutoDemanding {
        private var session: Session? = null

        override fun onWebSocketOpen(session: Session) {
            this.session = session
            open += session
        }

        override fun onWebSocketClose(statusCode: Int, reason: String?) {
            session?.let(open::remove)
        }

        override fun onWebSocketError(cause: Throwable) {
            logger?.fine("[Artisan] editor socket error: ${cause.message}")
            session?.let(open::remove)
        }
    }
}
