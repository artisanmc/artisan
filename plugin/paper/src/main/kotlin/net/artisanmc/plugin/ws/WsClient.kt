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

/** A network's hub as seen from a leaf: its `/ws/plugin`, the shared secret and the leaf's name. */
data class HubLink(val url: String, val secret: String, val serverName: String)

class WsClient(
    private val hub: HubLink,
    private val mcVersion: String,
    private val installedModules: () -> List<Map<String, String>> = { emptyList() },
    private val dataSources: () -> List<Map<String, Any?>> = { emptyList() },
    private val declaredModels: () -> List<Map<String, Any?>> = { emptyList() },
    private val editorScreens: () -> List<Map<String, Any?>> = { emptyList() },
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

    @Volatile private var socket: WebSocket? = null
    @Volatile private var retryDelay = 1L
    @Volatile private var authenticated = false
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
        val req = Request.Builder().url(hub.url).build()
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
                "plugin_version" to pluginVersion,
                "minecraft_version" to mcVersion,
                "installed_modules" to installedModules(),
                "data_sources" to dataSources(),
                "declared_models" to declaredModels(),
                "editor_screens" to editorScreens(),
                "server_config" to serverConfig(),
            )
            ws.send(mapper.writeValueAsString(hello))
        }

        override fun onMessage(ws: WebSocket, text: String) {
            val message = runCatching { mapper.readTree(text) }.getOrNull()
            when (message?.get("type")?.asText()) {
                "hello_ack" -> authenticated = true
                "session_replaced" -> clearRequests()
                "editor_link_result" -> {
                    requests.remove(message.path("request_id").asText())?.complete(message)
                    return
                }
            }
            onMessage(text)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            clearRequests()
            logger?.warning("WS failure: ${t.message}")
            scheduleReconnect()
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            clearRequests()
            ws.close(code, reason)
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            if (code != 1000) scheduleReconnect()
        }
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
