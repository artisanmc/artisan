package net.artisanmc.tunnelserver

import net.artisanmc.tunnel.Frame
import net.artisanmc.tunnel.RequestHead
import net.artisanmc.tunnel.ResponseHead
import net.artisanmc.tunnel.Tunnel
import org.eclipse.jetty.http.HttpField
import org.eclipse.jetty.http.HttpHeader
import org.eclipse.jetty.io.Content
import org.eclipse.jetty.server.Handler
import org.eclipse.jetty.server.HttpConfiguration
import org.eclipse.jetty.server.HttpConnectionFactory
import org.eclipse.jetty.server.Request
import org.eclipse.jetty.server.Response
import org.eclipse.jetty.server.Server
import org.eclipse.jetty.server.ServerConnector
import org.eclipse.jetty.util.Callback
import org.eclipse.jetty.util.thread.QueuedThreadPool
import org.eclipse.jetty.websocket.server.WebSocketUpgradeHandler
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

/**
 * The tunnel server (ADR `editor-tunnel`). A plugin opens `/tunnel` on [TunnelServerConfig.domain] with its
 * secret; the tunnel server derives `<id>` from it and passes every request to `<id>.<domain>`, HTTP
 * and WebSocket alike, through that tunnel. It stores nothing and reads nothing of what passes.
 */
class TunnelServer(private val config: TunnelServerConfig, private val logger: Logger = Logger.getLogger("artisan-tunnel-server")) {
    private val tunnels = ConcurrentHashMap<String, TunnelSession>()
    private var server: Server? = null

    val port: Int? get() = (server?.connectors?.firstOrNull() as? ServerConnector)?.localPort

    fun start() {
        val jetty = Server(QueuedThreadPool(200, 8).apply { name = "tunnel-server" })
        val http = HttpConfiguration().apply { sendServerVersion = false; sendXPoweredBy = false }
        val connector = ServerConnector(jetty, HttpConnectionFactory(http)).apply {
            port = config.port
            if (config.bind.isNotBlank()) host = config.bind
        }
        jetty.addConnector(connector)
        val sockets = WebSocketUpgradeHandler.from(jetty) { container ->
            container.idleTimeout = Duration.ofMinutes(10)
            container.maxTextMessageSize = MAX_MESSAGE
            container.maxBinaryMessageSize = MAX_MESSAGE
            container.maxFrameSize = MAX_MESSAGE
            container.addMapping("/*") { request, response, callback ->
                val host = host(request)
                val path = Request.getPathInContext(request)
                when {
                    // Any host but a connected tunnel's: the domain itself, or a name such as
                    // `connect.<domain>` when the domain's apex is another site.
                    path == Tunnel.CONNECT_PATH && tunnelFor(host) == null -> acceptTunnel(request, response, callback)
                    else -> {
                        val tunnel = tunnelFor(host)
                        if (tunnel == null) {
                            Response.writeError(request, response, callback, 502)
                            null
                        } else tunnel.openSocket(request, response, callback)
                    }
                }
            }
        }
        sockets.handler = Routes()
        jetty.handler = sockets
        jetty.start()
        server = jetty
        logger.info("Tunnel server listening on port ${connector.localPort} for *.${config.domain}")
    }

    fun join() = server?.join()

    fun stop() {
        tunnels.values.forEach { it.close(1001, "tunnel server stopping") }
        server?.stop()
        server = null
    }

    fun connected(): Set<String> = tunnels.keys.toSet()

    private fun acceptTunnel(request: Request, response: Response, callback: Callback): Any? {
        val secret = request.headers.get(HttpHeader.AUTHORIZATION)?.removePrefix("Bearer ")?.trim().orEmpty()
        val version = request.headers.get(Tunnel.VERSION_HEADER).orEmpty()
        val refusal = when {
            secret.length < 32 -> "missing or short secret"
            Tunnel.major(version) != Tunnel.major(Tunnel.VERSION) -> "tunnel version $version, tunnel server ${Tunnel.VERSION}: update Artisan or the tunnel server"
            config.accessCode.isNotEmpty() && request.headers.get(Tunnel.ACCESS_HEADER) != config.accessCode -> "wrong or missing access code (web.tunnel-access)"
            else -> null
        }
        val id = Tunnel.id(secret)
        val address = config.clientIp(request)
        val crowded = config.tunnelsPerAddress > 0 &&
            tunnels.values.count { it.address == address && it.id != id } >= config.tunnelsPerAddress
        // Refused tunnels still upgrade, to receive the reason in the close frame (4003): the plugin logs it.
        return TunnelSession(id, address, config, logger, refusal ?: "too many tunnels from this address".takeIf { crowded }, onOpen = { opened ->
            tunnels.put(id, opened)?.close(4000, "replaced by a new connection")
            logger.info("Tunnel $id connected (${tunnels.size} open)")
        }, onClose = { closed ->
            if (tunnels.remove(id, closed)) logger.info("Tunnel $id disconnected (${tunnels.size} open)")
        })
    }

    private fun tunnelFor(host: String): TunnelSession? {
        if (!host.endsWith(".${config.domain}")) return null
        val id = host.removeSuffix(".${config.domain}")
        if ('.' in id) return null
        return tunnels[id]
    }

    private fun host(request: Request) = Request.getServerName(request).lowercase().trimEnd('.')

    private inner class Routes : Handler.Abstract() {
        override fun handle(request: Request, response: Response, callback: Callback): Boolean {
            val host = host(request)
            val path = Request.getPathInContext(request)
            if (host == config.domain) {
                when (path) {
                    "/health" -> text(response, callback, 200, "ok")
                    else -> text(response, callback, 404, "Artisan tunnel server")
                }
                return true
            }
            val tunnel = tunnelFor(host)
            when {
                tunnel == null && path == "/health" -> text(response, callback, 200, "ok")
                tunnel == null -> text(response, callback, 502, "This Artisan server is not connected to the tunnel server.")
                config.blockedPrefixes.any { path.startsWith(it) } -> text(response, callback, 403, "Not served through the tunnel server.")
                !tunnel.limits.allowRequest() -> text(response, callback, 429, "This server's editor is over its tunnel limits. Try again later.")
                else -> proxy(tunnel, request, response, callback)
            }
            return true
        }
    }

    /** Blocking, on a Jetty thread: the request goes out in chunks, the response comes back the same way. */
    private fun proxy(tunnel: TunnelSession, request: Request, response: Response, callback: Callback) {
        val stream = tunnel.openStream() ?: return text(response, callback, 503, "Too many requests in flight for this server.")
        try {
            tunnel.send(Frame.json(Frame.Type.REQUEST, stream.id, RequestHead(request.method, pathAndQuery(request), forwardedHeaders(request, config))))
            val input = Content.Source.asInputStream(request)
            val buffer = ByteArray(Frame.CHUNK)
            var total = 0L
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > config.maxBodyBytes) {
                    tunnel.send(Frame(Frame.Type.RESET, stream.id))
                    return text(response, callback, 413, "Request too large for the tunnel server.")
                }
                if (read > 0) {
                    tunnel.limits.consume(read)
                    tunnel.send(Frame(Frame.Type.REQUEST_BODY, stream.id, buffer.copyOf(read)))
                }
            }
            tunnel.send(Frame(Frame.Type.REQUEST_END, stream.id))

            val first = stream.frames.poll(RESPONSE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            if (first == null || first.type != Frame.Type.RESPONSE) {
                if (first == null) tunnel.send(Frame(Frame.Type.RESET, stream.id))
                return text(response, callback, if (first == null) 504 else 502, "The Artisan server did not answer.")
            }
            val head = first.json<ResponseHead>()
            response.status = head.status
            for ((name, value) in head.headers) {
                if (name.lowercase() !in Tunnel.HOP_BY_HOP) response.headers.add(HttpField(name, value))
            }
            val output = Content.Sink.asOutputStream(response)
            while (true) {
                val frame = stream.frames.poll(RESPONSE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                when (frame?.type) {
                    Frame.Type.RESPONSE_BODY -> {
                        tunnel.limits.consume(frame.payload.size)
                        output.write(frame.payload)
                    }
                    Frame.Type.RESPONSE_END -> break
                    else -> {
                        if (frame == null) tunnel.send(Frame(Frame.Type.RESET, stream.id))
                        return callback.failed(IllegalStateException("tunnel stream ${stream.id} broken"))
                    }
                }
            }
            output.close()
            callback.succeeded()
        } catch (e: Exception) {
            tunnel.send(Frame(Frame.Type.RESET, stream.id))
            callback.failed(e)
        } finally {
            tunnel.closeStream(stream.id)
        }
    }

    private fun text(response: Response, callback: Callback, status: Int, body: String) {
        response.status = status
        response.headers.put(HttpHeader.CONTENT_TYPE, "text/plain; charset=utf-8")
        response.headers.put(HttpHeader.CACHE_CONTROL, "no-store")
        response.write(true, java.nio.ByteBuffer.wrap(body.toByteArray()), callback)
    }

    companion object {
        /** A browser message, or a plugin frame carrying one: the editor's largest is a 4 MiB bundle as text. */
        const val MAX_MESSAGE = 32L * 1024 * 1024
        const val RESPONSE_TIMEOUT_SECONDS = 60L

        fun pathAndQuery(request: Request): String {
            val uri = request.httpURI
            return (uri.path ?: "/") + (uri.query?.let { "?$it" } ?: "")
        }

        /**
         * The browser's headers as sent, `Host` and `Origin` included, plus where the request came
         * from and the scheme the browser used: the hub marks its session cookie `Secure` from it.
         */
        fun forwardedHeaders(request: Request, config: TunnelServerConfig): List<List<String>> {
            val headers = request.headers
                .filter { it.name.lowercase() !in Tunnel.HOP_BY_HOP && !it.name.startsWith("X-Forwarded-", ignoreCase = true) }
                .map { listOf(it.name, it.value) }
                .toMutableList()
            headers += listOf("X-Forwarded-For", config.clientIp(request))
            headers += listOf("X-Forwarded-Proto", config.publicScheme)
            return headers
        }
    }
}
