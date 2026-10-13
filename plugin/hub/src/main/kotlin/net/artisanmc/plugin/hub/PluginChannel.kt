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
 * WebSocket `/ws/plugin` : les autres serveurs du réseau s'y relient avec leur client du
 * backend, inchangé. Le `hello` doit porter le secret partagé (`server_key`) et le nom du
 * serveur (`proxy_name`) ; sans eux la connexion est fermée.
 */
class PluginChannel(
    private val servers: Servers,
    private val secret: String,
    private val editors: EditorChannel,
    private val publicUrl: () -> String,
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
        val server = servers.remote(name) { RemoteServer(it, publicUrl) }
        val ack = mapOf(
            "type" to "hello_ack",
            "session_id" to UUID.randomUUID().toString(),
            "server_id" to name,
            "editor_url" to publicUrl(),
            "network_name" to servers.local.label,
            // Un objet sans adresse laisse au serveur le pack qu'il a déjà ; null le lui retirerait.
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
