package net.artisanmc.plugin.hub

import net.artisanmc.tunnel.Frame
import net.artisanmc.tunnel.Hello
import net.artisanmc.tunnel.NameRequest
import net.artisanmc.tunnel.NameResult
import net.artisanmc.tunnel.RequestHead
import net.artisanmc.tunnel.ResponseHead
import net.artisanmc.tunnel.Tunnel
import net.artisanmc.tunnel.WsClose
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The editor reached through a tunnel server (ADR `editor-tunnel`): one outgoing WebSocket to the tunnel server,
 * which passes each browser request and WebSocket through it. Each one is replayed, unchanged,
 * on this server's own web port: the tunnel server understands nothing of the editor, and the editor
 * served is the one in this jar. [onUrl] gets the address browsers use, null while disconnected.
 */
class TunnelClient(
    server: String,
    private val secret: String,
    private val accessCode: String,
    private val localPort: () -> Int?,
    private val logger: Logger,
    /** This server's id, when it shares its address with the other servers of its network (ADR `peer-servers`). */
    private val member: String = "",
    private val onUrl: (String?) -> Unit,
) : TunnelNames {
    private val connectUrl = connectUrl(server)
    private val threads = Executors.newCachedThreadPool { r -> Thread(r, "artisan-tunnel").apply { isDaemon = true } }
    private val retries: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "artisan-tunnel-retry").apply { isDaemon = true } }
    private val serverClient = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private val local = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val requests = ConcurrentHashMap<Int, PendingRequest>()
    private val sockets = ConcurrentHashMap<Int, WebSocket>()
    @Volatile private var tunnel: WebSocket? = null
    @Volatile private var stopped = false
    @Volatile private var retryDelay = 1L
    @Volatile private var lastRefusal: String? = null
    @Volatile override var url: String? = null
        private set
    @Volatile override var name: String? = null
        private set
    @Volatile override var names: Boolean = false
        private set
    private val nameRequests = ConcurrentHashMap<Int, CompletableFuture<NameResult>>()
    private val nextNameRequest = AtomicInteger(1)

    private class PendingRequest(val head: RequestHead) {
        val body = ByteArrayOutputStream()
    }

    fun start() = connect()

    fun stop() {
        stopped = true
        retries.shutdownNow()
        tunnel?.close(1001, "server stopping")
        closeStreams()
        threads.shutdownNow()
        serverClient.dispatcher.executorService.shutdown()
        local.dispatcher.executorService.shutdown()
    }

    private fun connect() {
        if (stopped) return
        val request = Request.Builder().url(connectUrl)
            .header("Authorization", "Bearer $secret")
            .header(Tunnel.VERSION_HEADER, Tunnel.VERSION)
            .apply { if (accessCode.isNotBlank()) header(Tunnel.ACCESS_HEADER, accessCode) }
            .apply { if (member.isNotBlank()) header(Tunnel.MEMBER_HEADER, member) }
            .build()
        tunnel = serverClient.newWebSocket(request, ServerListener())
    }

    private fun reconnect() {
        url = null
        onUrl(null)
        closeStreams()
        if (stopped) return
        val delay = retryDelay
        retryDelay = (retryDelay * 2).coerceAtMost(MAX_RETRY_SECONDS)
        runCatching { retries.schedule(::connect, delay, TimeUnit.SECONDS) }
    }

    private fun closeStreams() {
        nameRequests.values.forEach { it.complete(NameResult(false, error = OFFLINE)) }
        nameRequests.clear()
        requests.clear()
        sockets.values.forEach { it.cancel() }
        sockets.clear()
    }

    private inner class ServerListener : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (webSocket !== tunnel) return
            val frame = runCatching { Frame.decode(bytes.asByteBuffer()) }.getOrElse {
                logger.warning("[Artisan] Tunnel server sent an unreadable frame: ${it.message}")
                return
            }
            handle(frame)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            if (code in 4000..4999 && reason != lastRefusal) {
                lastRefusal = reason
                logger.warning("[Artisan] Tunnel server refused this server: $reason")
                retryDelay = MAX_RETRY_SECONDS
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (webSocket === tunnel) reconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (webSocket !== tunnel) return
            if (retryDelay == 1L) logger.warning("[Artisan] Tunnel server unreachable at $connectUrl (${t.message ?: response?.code}), retrying")
            reconnect()
        }
    }

    private fun handle(frame: Frame) {
        val id = frame.stream
        when (frame.type) {
            Frame.Type.HELLO -> {
                // Again whenever the address changes: a name taken here or by another server of the network.
                val hello = frame.json<Hello>()
                retryDelay = 1
                lastRefusal = null
                if (hello.url != url) logger.info("[Artisan] Editor reachable through the tunnel server at ${hello.url}")
                url = hello.url
                name = hello.name
                names = hello.names
                onUrl(hello.url)
            }
            Frame.Type.NAME_RESULT -> nameRequests.remove(id)?.complete(frame.json<NameResult>())
            Frame.Type.REQUEST -> requests[id] = PendingRequest(frame.json())
            Frame.Type.REQUEST_BODY -> {
                val pending = requests[id] ?: return
                if (pending.body.size() + frame.payload.size > MAX_BODY) {
                    requests.remove(id)
                    respond(id, 413)
                } else pending.body.write(frame.payload)
            }
            Frame.Type.REQUEST_END -> requests.remove(id)?.let { pending -> threads.execute { forward(id, pending) } }
            Frame.Type.WS_OPEN -> {
                val head = frame.json<RequestHead>()
                threads.execute { openSocket(id, head) }
            }
            Frame.Type.WS_TEXT -> sockets[id]?.send(frame.text())
            Frame.Type.WS_BINARY -> sockets[id]?.send(frame.payload.toByteString())
            Frame.Type.WS_CLOSE -> sockets.remove(id)?.let { socket ->
                val close = frame.json<WsClose>()
                socket.close(validCloseCode(close.code), close.reason.take(MAX_REASON))
            }
            Frame.Type.RESET -> {
                requests.remove(id)
                sockets.remove(id)?.cancel()
            }
            else -> logger.fine("[Artisan] Tunnel server sent an unexpected ${frame.type}")
        }
    }

    override fun requestName(name: String, check: Boolean): CompletableFuture<NameResult> {
        if (tunnel == null || url == null) return CompletableFuture.completedFuture(NameResult(false, error = OFFLINE))
        val number = nextNameRequest.getAndIncrement()
        val answer = CompletableFuture<NameResult>()
        nameRequests[number] = answer
        send(Frame.json(Frame.Type.NAME, number, NameRequest(name, check)))
        return answer.completeOnTimeout(NameResult(false, error = OFFLINE), NAME_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .whenComplete { _, _ -> nameRequests.remove(number) }
    }

    /** Replays one browser request on the local web port and sends its response back in chunks. */
    private fun forward(id: Int, pending: PendingRequest) {
        val port = localPort() ?: return respond(id, 503)
        val head = pending.head
        val bytes = pending.body.toByteArray()
        val body = if (bytes.isEmpty() && head.method in BODYLESS) null else bytes.toRequestBody(null)
        val request = Request.Builder()
            .url("http://127.0.0.1:$port${head.path}")
            .headers(headersOf(head.headers))
            .method(head.method, body)
            .build()
        var started = false
        try {
            local.newCall(request).execute().use { response ->
                send(Frame.json(Frame.Type.RESPONSE, id, ResponseHead(response.code, headerList(response.headers))))
                started = true
                val source = response.body?.byteStream()
                if (source != null) {
                    val buffer = ByteArray(Frame.CHUNK)
                    while (true) {
                        val read = source.read(buffer)
                        if (read < 0) break
                        if (read > 0) send(Frame(Frame.Type.RESPONSE_BODY, id, buffer.copyOf(read)), wait = true)
                    }
                }
                send(Frame(Frame.Type.RESPONSE_END, id))
            }
        } catch (e: Exception) {
            logger.log(Level.FINE, "[Artisan] Tunnelled ${head.method} ${head.path} failed", e)
            if (started) send(Frame(Frame.Type.RESET, id)) else respond(id, 502)
        }
    }

    private fun respond(id: Int, status: Int) {
        send(Frame.json(Frame.Type.RESPONSE, id, ResponseHead(status)))
        send(Frame(Frame.Type.RESPONSE_END, id))
    }

    private fun openSocket(id: Int, head: RequestHead) {
        val port = localPort() ?: return send(Frame.json(Frame.Type.WS_OPENED, id, ResponseHead(503)))
        val request = Request.Builder()
            .url("http://127.0.0.1:$port${head.path}")
            .headers(headersOf(head.headers))
            .build()
        local.newWebSocket(request, object : WebSocketListener() {
            @Volatile private var open = false

            override fun onOpen(webSocket: WebSocket, response: Response) {
                open = true
                sockets[id] = webSocket
                send(Frame.json(Frame.Type.WS_OPENED, id, ResponseHead(101, headerList(response.headers).filter { it[0].equals("Sec-WebSocket-Protocol", true) })))
            }

            override fun onMessage(webSocket: WebSocket, text: String) = send(Frame(Frame.Type.WS_TEXT, id, text.toByteArray()), wait = true)

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = send(Frame(Frame.Type.WS_BINARY, id, bytes.toByteArray()), wait = true)

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(validCloseCode(code), null)
                if (sockets.remove(id) != null) send(Frame.json(Frame.Type.WS_CLOSE, id, WsClose(code, reason)))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!open) send(Frame.json(Frame.Type.WS_OPENED, id, ResponseHead(response?.code ?: 502)))
                else if (sockets.remove(id) != null) send(Frame.json(Frame.Type.WS_CLOSE, id, WsClose(1011, "server error")))
            }
        })
    }

    /**
     * OkHttp closes a socket whose send queue passes 16 MiB: a large response waits for the
     * queue to drain instead ([wait]). Control frames never wait.
     */
    private fun send(frame: Frame, wait: Boolean = false) {
        val socket = tunnel ?: return
        if (wait) {
            while (socket.queueSize() > QUEUE_HIGH_WATER && !stopped && socket === tunnel) Thread.sleep(5)
        }
        socket.send(frame.encode().toByteString())
    }

    private fun headersOf(list: List<List<String>>): Headers {
        val builder = Headers.Builder()
        for (pair in list) {
            if (pair.size != 2 || pair[0].lowercase() in Tunnel.HOP_BY_HOP) continue
            runCatching { builder.add(pair[0], pair[1]) }
        }
        return builder.build()
    }

    private fun headerList(headers: Headers): List<List<String>> =
        headers.filter { (name, _) -> name.lowercase() !in Tunnel.HOP_BY_HOP }.map { (name, value) -> listOf(name, value) }

    companion object {
        private const val MAX_RETRY_SECONDS = 60L
        private const val NAME_TIMEOUT_SECONDS = 10L
        /** A name asked while the tunnel is down, or not answered in time. */
        const val OFFLINE = "offline"
        private const val QUEUE_HIGH_WATER = 4L * 1024 * 1024
        /** The largest browser upload replayed: the hub's own resource pack limit. */
        const val MAX_BODY = 100 * 1024 * 1024
        private const val MAX_REASON = 120
        private val BODYLESS = setOf("GET", "HEAD", "OPTIONS", "DELETE")

        /** `tunnel.example.net`, `tunnel.example.net:8443` or a full `http(s)://` address. */
        fun connectUrl(server: String): String {
            val trimmed = server.trim().trimEnd('/')
            val base = when {
                trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
                trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
                trimmed.startsWith("ws://") || trimmed.startsWith("wss://") -> trimmed
                else -> "wss://$trimmed"
            }
            return base + Tunnel.CONNECT_PATH
        }

        /** The tunnel's secret, generated once: it decides the editor's address on the tunnel server. */
        fun secret(file: File): String {
            file.takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.length >= 32 }?.let { return it }
            val bytes = ByteArray(32).also(SecureRandom()::nextBytes)
            val secret = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            file.parentFile?.mkdirs()
            file.writeText(secret)
            return secret
        }

        /**
         * The tunnel secret of the servers of one database (ADR `peer-servers`), derived from its
         * network secret: they all get the same address, and only they can claim it.
         */
        const val MEMBER_HEADER = Tunnel.MEMBER_HEADER

        fun networkSecret(shared: String): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256").digest("artisan-tunnel:$shared".toByteArray())
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
        }

        /** 1005, 1006 and 1015 describe a close, they cannot be sent. */
        private fun validCloseCode(code: Int) = if (code in 1000..4999 && code !in setOf(1004, 1005, 1006, 1015)) code else 1000
    }
}
