package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID
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
    private val editorAccessMode: String = "invitation",
) {
    private val httpClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val mapper = ObjectMapper()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var retryDelay = 1L
    @Volatile private var authenticated = false
    private val memberRequests = ConcurrentHashMap<String, CompletableFuture<String>>()

    fun addMember(email: String): CompletableFuture<String> {
        if (editorAccessMode != "console") return CompletableFuture.completedFuture("console_disabled")
        if (!authenticated) return CompletableFuture.completedFuture("offline")
        val id = UUID.randomUUID().toString()
        val result = CompletableFuture<String>()
        memberRequests[id] = result
        result.completeOnTimeout("timeout", 15, TimeUnit.SECONDS)
            .whenComplete { _, _ -> memberRequests.remove(id) }
        if (socket?.send(mapper.writeValueAsString(mapOf("type" to "member_add", "request_id" to id, "email" to email))) != true) {
            result.complete("offline")
        }
        return result
    }

    private fun clearMemberRequests() {
        authenticated = false
        memberRequests.values.forEach { it.complete("offline") }
        memberRequests.clear()
    }

    fun connect() {
        val req = Request.Builder().url(url).build()
        socket = httpClient.newWebSocket(req, Listener())
    }

    fun send(msg: Any) {
        socket?.send(mapper.writeValueAsString(msg))
    }

    fun disconnect() {
        clearMemberRequests()
        scheduler.shutdownNow()
        socket?.close(1000, "Plugin disabling")
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
    }

    companion object {
        /**
         * Version du **format de contenu** de projet que ce plugin sait lire
         * (ADR `content-version-negotiation`). À incrémenter à chaque évolution
         * cassante du wire. 2 = étapes structurées keyed.
         */
        const val CONTENT_VERSION = 2
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            retryDelay = 1
            val hello = mapOf(
                "type" to "hello",
                "editor_access_mode" to editorAccessMode,
                "protocol_version" to "1",
                // Wire de contenu de projet : 2 = étapes structurées keyed
                // (ADR content-version-negotiation). Absente = 1 (DSL legacy).
                "content_version" to CONTENT_VERSION,
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

        override fun onMessage(ws: WebSocket, text: String) {
            val message = runCatching { mapper.readTree(text) }.getOrNull()
            when (message?.get("type")?.asText()) {
                "hello_ack" -> authenticated = true
                "session_replaced" -> clearMemberRequests()
                "member_add_result" -> {
                    val result = if (message.path("ok").asBoolean()) {
                        if (message.path("already_member").asBoolean()) "already_member" else "added"
                    } else message.path("error").asText("failed")
                    memberRequests.remove(message.path("request_id").asText())?.complete(result)
                    return
                }
            }
            onMessage(text)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            clearMemberRequests()
            logger?.warning("WS failure: ${t.message}")
            scheduleReconnect()
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            clearMemberRequests()
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
