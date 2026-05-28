package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class SetupClient(
    private val url: String,
    private val code: String?,            // null → B1 (generate code); non-null → B2 (claim code)
    private val onCode: (code: String, url: String) -> Unit,
    private val onLinked: (serverKey: String) -> Unit,
) {
    private val mapper = ObjectMapper()
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)   // no read timeout — we wait for the push
        .build()
    @Volatile private var socket: WebSocket? = null
    private val disconnected = AtomicBoolean(false)

    fun connect() {
        val req = Request.Builder().url(url).build()
        socket = httpClient.newWebSocket(req, Listener())
    }

    fun disconnect() {
        if (!disconnected.compareAndSet(false, true)) return
        socket?.close(1000, "Setup done")
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            val msg = if (code != null)
                mapOf("type" to "setup_claim", "code" to code)
            else
                mapOf("type" to "setup_request")
            ws.send(mapper.writeValueAsString(msg))
        }

        override fun onMessage(ws: WebSocket, text: String) {
            val node = runCatching { mapper.readTree(text) }.getOrNull() ?: return
            when (node["type"]?.asText()) {
                "setup_code" -> {
                    val c = node["code"]?.asText()?.takeIf { it.isNotBlank() } ?: return
                    val u = node["url"]?.asText()?.takeIf { it.isNotBlank() } ?: return
                    onCode(c, u)
                }
                "link_confirmed" -> {
                    val key = node["server_key"]?.asText()?.takeIf { it.isNotBlank() } ?: return
                    try {
                        onLinked(key)
                    } finally {
                        disconnect()
                    }
                }
            }
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            // No reconnect — user must re-run /artisan setup
            httpClient.dispatcher.cancelAll()
            httpClient.connectionPool.evictAll()
            httpClient.dispatcher.executorService.shutdown()
        }
    }
}
