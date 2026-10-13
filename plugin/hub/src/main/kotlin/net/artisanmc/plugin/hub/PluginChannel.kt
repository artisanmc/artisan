package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.protocol.ProtocolVersion
import org.eclipse.jetty.websocket.api.Callback
import org.eclipse.jetty.websocket.api.Session
import java.security.MessageDigest
import java.util.UUID
import java.util.logging.Logger

/**
 * WebSocket `/ws/plugin`: the network's leaves connect here. The `hello` must carry the
 * shared secret (`server_key`) and the server name (`proxy_name`); without them the
 * connection is closed.
 */
class PluginChannel(
    private val servers: Servers,
    private val secret: String,
    private val sessions: Sessions,
    private val editors: EditorChannel,
    /** The hub's public address; the host a player joined through is the fallback. */
    private val publicUrl: (host: String?) -> String,
    private val logger: Logger?,
) {
    fun endpoint(): Session.Listener = object : Session.Listener.AutoDemanding {
        private var session: Session? = null
        @Volatile private var server: RemoteServer? = null

        override fun onWebSocketOpen(session: Session) {
            this.session = session
        }

        override fun onWebSocketText(text: String) {
            val session = session ?: return
            val message = runCatching { Call.mapper.readTree(text) }.getOrNull()?.takeIf { it.isObject } ?: return
            val current = server
            if (current != null && message.path("type").asText() == "editor_link") return link(session, message)
            if (current != null) return current.receive(message, editors)
            if (message.path("type").asText() != "hello") return
            val name = message.path("proxy_name").asText("")
            when {
                !authorized(message.path("server_key").asText("")) -> refuse(session, "invalid server_key")
                !NAME.matches(name) || name.equals(Servers.LOCAL, ignoreCase = true) -> refuse(session, "invalid proxy_name")
                else -> server = welcome(session, name, message as ObjectNode)
            }
        }

        override fun onWebSocketClose(statusCode: Int, reason: String?) {
            session?.let { server?.detach(it) }
        }

        override fun onWebSocketError(cause: Throwable) {
            logger?.fine("[Artisan] plugin socket error: ${cause.message}")
            session?.let { server?.detach(it) }
        }
    }

    private fun welcome(session: Session, name: String, hello: ObjectNode): RemoteServer {
        val server = servers.remote(name) { RemoteServer(it, publicUrl = { publicUrl(null) }) }
        val ack = mapOf(
            "type" to "hello_ack",
            "session_id" to UUID.randomUUID().toString(),
            "server_id" to name,
            "editor_url" to publicUrl(null),
            "network_name" to servers.local.label,
            // An object without an address leaves the server its current pack; null would remove it.
            "resource_pack" to (server.pack ?: emptyMap<String, String>()),
        )
        session.sendText(Call.mapper.writeValueAsString(ack), Callback.NOOP)
        server.attach(session, hello)
        if (server.updateRequired) {
            logger?.warning("[Artisan] Server $name speaks protocol ${hello.path("protocol_version").asText("?")}, the hub ${ProtocolVersion.CURRENT}: update both to the same release")
        } else {
            logger?.info("[Artisan] Server $name connected to the editor")
        }
        return server
    }

    /**
     * `/artisan editor` typed on this server: the hub gives the link. It checks no
     * permission itself; it uses the ones the server read for this player.
     */
    private fun link(session: Session, message: JsonNode) {
        val player = runCatching { UUID.fromString(message.path("player_id").asText()) }.getOrNull()
        val name = message.path("player_name").asText("")
        val permissions = message.path("permissions").map { it.asText() }.filter { it in EditorPermissions.ALL }.toSet()
        val result = when {
            player == null || name.isEmpty() || EditorPermissions.VIEW !in permissions -> mapOf("ok" to false, "error" to "invalid_input")
            else -> when (val link = sessions.issueLink(player, name, permissions)) {
                is Sessions.LinkResult.Issued -> {
                    val host = message.path("host").asText("").ifEmpty { null }
                    mapOf("ok" to true, "url" to publicUrl(host) + HubServer.LOGIN + link.token)
                }
                is Sessions.LinkResult.TooSoon -> mapOf("ok" to false, "error" to "too_soon", "retry_after" to link.retryAfter.seconds.coerceAtLeast(1))
            }
        }
        val reply = mapOf("type" to "editor_link_result", "request_id" to message.path("request_id").asText()) + result
        session.sendText(Call.mapper.writeValueAsString(reply), Callback.NOOP)
    }

    private fun refuse(session: Session, reason: String) {
        logger?.warning("[Artisan] Server refused on /ws/plugin: $reason")
        session.close(POLICY_VIOLATION, reason, Callback.NOOP)
    }

    private fun authorized(key: String) =
        secret.isNotEmpty() && MessageDigest.isEqual(key.toByteArray(), secret.toByteArray())

    private companion object {
        val NAME = Regex("[A-Za-z0-9_-]{1,64}")
        const val POLICY_VIOLATION = 1008
    }
}
