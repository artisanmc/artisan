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
 * shared secret (`server_key`), the server id (`server_uuid`) and the server name
 * (`proxy_name`); without them the connection is closed.
 */
class PluginChannel(
    private val servers: Servers,
    private val secret: String,
    private val sessions: Sessions,
    private val editors: EditorChannel,
    /** The hub's public address; the host a player joined through is the fallback. */
    private val publicUrl: (host: String?) -> String,
    private val logger: Logger?,
    /** The suite database this hub uses; null for an embedded one, which a Network cannot share. */
    private val databaseId: () -> String?,
    /** False while the hub's suite database is still opening (issue #42): a leaf is told to retry. */
    private val databaseOpen: () -> Boolean = { true },
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
            if (current != null) when (message.path("type").asText()) {
                "editor_link" -> return link(session, message, current.id)
                "editor_permissions" -> return sessions.refresh(current.id, permissions(message.path("players")))
                "editor_logout" -> return logout(session, message)
            }
            if (current != null) return current.receive(message, editors)
            if (message.path("type").asText() != "hello") return
            val name = message.path("proxy_name").asText("")
            val id = message.path("server_uuid").asText("")
            when {
                !authorized(message.path("server_key").asText("")) -> refuse(session, "invalid server_key")
                !NAME.matches(name) -> refuse(session, "invalid proxy_name")
                !SERVER_ID.matches(id) -> refuse(session, "invalid server_uuid")
                id == servers.local.id -> refuse(session, "server id $id is the hub's own: plugins/Artisan/server-id was copied from it")
                !databaseOpen() -> refuse(session, "the hub's suite database is not open yet: retry")
                databaseId() == null -> refuse(session, "the hub uses an embedded H2 database: a network needs a shared MySQL or MariaDB database")
                message.path("database_id").asText("") != databaseId() ->
                    refuse(session, "not on the hub's database: every server of a network must use the same MySQL or MariaDB database")
                else -> server = welcome(session, id, name, message as ObjectNode)
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

    private fun welcome(session: Session, id: String, name: String, hello: ObjectNode): RemoteServer {
        val server = servers.remote(id, name)
        val ack = mapOf(
            "type" to "hello_ack",
            "session_id" to UUID.randomUUID().toString(),
            "server_id" to id,
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
    private fun permissions(players: JsonNode): Map<UUID, Set<String>> =
        players.properties().mapNotNull { (id, list) ->
            runCatching { UUID.fromString(id) }.getOrNull()?.let { it to list.map { p -> p.asText() }.filter { p -> p in EditorPermissions.ALL }.toSet() }
        }.toMap()

    /** `/artisan editor logout` typed on a network server. */
    private fun logout(session: Session, message: JsonNode) {
        val player = runCatching { UUID.fromString(message.path("player_id").asText()) }.getOrNull()
        val closed = player?.let(sessions::closeAll) ?: 0
        val reply = mapOf("type" to "editor_logout_result", "request_id" to message.path("request_id").asText(), "ok" to (player != null), "closed" to closed)
        session.sendText(Call.mapper.writeValueAsString(reply), Callback.NOOP)
    }

    private fun link(session: Session, message: JsonNode, origin: String) {
        val player = runCatching { UUID.fromString(message.path("player_id").asText()) }.getOrNull()
        val name = message.path("player_name").asText("")
        val permissions = message.path("permissions").map { it.asText() }.filter { it in EditorPermissions.ALL }.toSet()
        val result = when {
            player == null || name.isEmpty() || EditorPermissions.VIEW !in permissions -> mapOf("ok" to false, "error" to "invalid_input")
            else -> when (val link = sessions.issueLink(player, name, permissions, origin)) {
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
        /** A UUID (`plugins/Artisan/server-id`); the tests use shorter ids. */
        val SERVER_ID = Regex("[A-Za-z0-9-]{1,36}")
        const val POLICY_VIOLATION = 1008
    }
}
