package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID
import java.util.logging.Logger

/**
 * A network's hub as seen from a leaf: its `/ws/plugin`, the shared secret, the leaf's name,
 * server id and suite database. [databaseId] is read when the socket opens: null while the
 * suite database is still opening (issue #42), and the connection waits for it.
 *
 * A [peer] is another server that serves its own editor, found in the suite database (ADR
 * `peer-servers`): [url] first, then each of [alternates] in turn until one answers.
 */
data class HubLink(
    val url: String,
    val secret: String,
    val serverName: String,
    val databaseId: () -> String? = { "" },
    val serverUuid: String = "",
    val alternates: List<String> = emptyList(),
    val peer: Boolean = false,
) {
    val urls: List<String> get() = (listOf(url) + alternates).filter { it.isNotBlank() }.distinct()
}

class WsClient(
    private val hub: HubLink,
    private val mcVersion: String,
    /** Its fields go in the `hello`, after the server's identity. */
    private val announcement: () -> net.artisanmc.plugin.protocol.ServerAnnouncement = { net.artisanmc.plugin.protocol.ServerAnnouncement.EMPTY },
    private val serverConfig: () -> Map<String, Any?>? = { null },
    private val onMessage: (String) -> Unit,
    private val logger: Logger? = null,
    private val pluginVersion: String = "1.0.0",
) {
    private val httpClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val mapper = ObjectMapper()

    private val urls = hub.urls
    @Volatile private var index = 0
    /** The address tried, or connected to: [HubLink.url] or one of its alternates. */
    val url: String get() = urls.getOrElse(index) { hub.url }
    @Volatile private var socket: WebSocket? = null
    @Volatile private var retryDelay = 1L
    @Volatile private var authenticated = false
    @Volatile private var waitingForDatabase = false
    private val requests = ConcurrentHashMap<String, CompletableFuture<JsonNode?>>()

    /** A request to the hub; its `<type>_result` reply, or null when offline or unanswered. */
    fun request(message: Map<String, Any?>, timeoutSeconds: Long = 15): CompletableFuture<JsonNode?> {
        if (!authenticated) return CompletableFuture.completedFuture(null)
        val id = UUID.randomUUID().toString()
        val result = CompletableFuture<JsonNode?>()
        requests[id] = result
        result.completeOnTimeout(null, timeoutSeconds, TimeUnit.SECONDS).whenComplete { _, _ -> requests.remove(id) }
        if (socket?.send(mapper.writeValueAsString(message + ("request_id" to id))) != true) result.complete(null)
        return result
    }

    private fun clearRequests() {
        authenticated = false
        requests.values.forEach { it.complete(null) }
        requests.clear()
    }

    fun connect() {
        if (scheduler.isShutdown) return
        if (hub.databaseId() == null) {
            // The hub refuses a hello without the database id: wait for the database instead.
            if (!waitingForDatabase) logger?.info("[Artisan] Waiting for the suite database before connecting to the hub")
            waitingForDatabase = true
            runCatching { scheduler.schedule(::connect, DATABASE_RETRY_SECONDS, TimeUnit.SECONDS) }
            return
        }
        waitingForDatabase = false
        val req = Request.Builder().url(url).build()
        socket = httpClient.newWebSocket(req, Listener())
    }

    fun send(msg: Any) {
        socket?.send(mapper.writeValueAsString(msg))
    }

    fun disconnect() {
        clearRequests()
        scheduler.shutdownNow()
        socket?.close(1000, "Plugin disabling")
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            retryDelay = 1
            val hello = mapOf(
                "type" to "hello",
                "protocol_version" to net.artisanmc.plugin.protocol.ProtocolVersion.CURRENT,
                "server_key" to hub.secret,
                "proxy_name" to hub.serverName,
                "server_uuid" to hub.serverUuid,
                "database_id" to hub.databaseId().orEmpty(),
                "plugin_version" to pluginVersion,
                "minecraft_version" to mcVersion,
            ) + announcement().toMap() + ("server_config" to serverConfig())
            ws.send(mapper.writeValueAsString(hello))
        }

        override fun onMessage(ws: WebSocket, text: String) {
            val message = runCatching { mapper.readTree(text) }.getOrNull()
            when (message?.get("type")?.asText()) {
                "hello_ack" -> authenticated = true
                "session_replaced" -> clearRequests()
                "editor_link_result", "editor_logout_result" -> {
                    requests.remove(message.path("request_id").asText())?.complete(message)
                    return
                }
            }
            onMessage(text)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            clearRequests()
            // A peer may not answer on one of its addresses, or be stopping: said once, not on every retry.
            if (!hub.peer) logger?.warning("WS failure: ${t.message}")
            else if (retryDelay == 1L) logger?.info("[Artisan] Network server not reached at $url (${t.message}), retrying")
            nextAddress()
            scheduleReconnect()
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            clearRequests()
            ws.close(code, reason)
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            if (code == 1008 && !hub.peer) logger?.severe("[Artisan] The hub refused this server: $reason")
            else if (code == 1008) logger?.info("[Artisan] Refused at $url: $reason")
            if (code != 1000) {
                nextAddress()
                scheduleReconnect()
            }
        }
    }

    private companion object {
        const val DATABASE_RETRY_SECONDS = 2L
    }

    /** The next address of the link: an internal one that answers nothing, or another server, falls back to the public one. */
    private fun nextAddress() {
        if (urls.size > 1) index = (index + 1) % urls.size
    }

    private fun scheduleReconnect() {
        if (scheduler.isShutdown) return
        val delay = retryDelay
        retryDelay = minOf(retryDelay * 2, 60L)
        try {
            scheduler.schedule(::connect, delay, TimeUnit.SECONDS)
        } catch (_: Exception) {
            // scheduler was shut down between the isShutdown check and schedule() — ignore
        }
    }
}
