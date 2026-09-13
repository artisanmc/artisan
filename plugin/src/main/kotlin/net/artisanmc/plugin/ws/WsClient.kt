package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

class WsClient(
    private val url: String,
    private val serverKey: String,
    private val mcVersion: String,
    private val currentBundleHash: String = "",
    private val localProjectIds: List<String> = emptyList(),
    private val customItemsHash: String = "",
    private val installedModules: () -> List<Map<String, String>> = { emptyList() },
    private val dataSources: () -> List<Map<String, Any?>> = { emptyList() },
    private val declaredModels: () -> List<Map<String, Any?>> = { emptyList() },
    private val editorScreens: () -> List<Map<String, Any?>> = { emptyList() },
    private val onMessage: (String) -> Unit,
    private val logger: Logger? = null,
    private val projectPresence: () -> Map<String, Any> = { emptyMap() },
) {
    private val httpClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val mapper = ObjectMapper()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var retryDelay = 1L

    fun connect() {
        val req = Request.Builder().url(url).build()
        socket = httpClient.newWebSocket(req, Listener())
    }

    fun send(msg: Any) {
        socket?.send(mapper.writeValueAsString(msg))
    }

    fun disconnect() {
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
                "protocol_version" to "1",
                "core_version" to "1.0.0",   // Mirrors plugin_version (kept for backward compat).
                "server_key" to serverKey,
                "plugin_version" to "1.0.0",
                "minecraft_version" to mcVersion,
                "current_bundle_hash" to currentBundleHash,
                "local_project_ids" to localProjectIds,
                "custom_items_hash" to customItemsHash.ifEmpty { null },
                "installed_modules" to installedModules(),
                "data_sources" to dataSources(),
                // Module-declared Data models (ADR composable-data-models §4):
                // model/v1 documents passed through verbatim.
                "declared_models" to declaredModels(),
                // Module-declared Config screens (ADR module-config-screens).
                "editor_screens" to editorScreens(),
            ) + projectPresence()
            ws.send(mapper.writeValueAsString(hello))
        }

        override fun onMessage(ws: WebSocket, text: String) = onMessage(text)

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            logger?.warning("WS failure: ${t.message}")
            scheduleReconnect()
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
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
