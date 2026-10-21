package net.artisanmc.tunnelserver

import net.artisanmc.tunnel.Frame
import net.artisanmc.tunnel.Hello
import net.artisanmc.tunnel.NameRequest
import net.artisanmc.tunnel.RequestHead
import net.artisanmc.tunnel.ResponseHead
import net.artisanmc.tunnel.WsClose
import org.eclipse.jetty.server.Request
import org.eclipse.jetty.server.Response
import org.eclipse.jetty.util.Callback
import org.eclipse.jetty.websocket.api.Session
import org.eclipse.jetty.websocket.server.ServerUpgradeResponse
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger
import org.eclipse.jetty.websocket.api.Callback as WsCallback

/**
 * One plugin's tunnel, from the tunnel server's side. HTTP streams wait on a queue read by their Jetty
 * thread ([TunnelServer.proxy]); browser WebSockets are bridged frame by frame.
 * A [refusal] closes the tunnel right after the upgrade, with the reason for the plugin's log.
 */
class TunnelSession(
    val id: String,
    /** The plugin's address, for [TunnelServerConfig.tunnelsPerAddress]. */
    val address: String,
    private val config: TunnelServerConfig,
    private val logger: Logger,
    private val refusal: String?,
    /** The server it names itself ([Tunnel.MEMBER_HEADER]); empty for none. */
    val member: String = "",
    private val onOpen: (TunnelSession) -> Unit,
    private val onClose: (TunnelSession) -> Unit,
    /** What the plugin is told once accepted, and again when its address changes. */
    private val hello: () -> Hello = { Hello(config.publicUrl(id)) },
    /** The plugin asks for a name ([Frame.Type.NAME]) on its own stream number. */
    private val onName: (TunnelSession, Int, NameRequest) -> Unit = { _, _, _ -> },
) : Session.Listener.AutoDemanding {
    class Stream(val id: Int) {
        val frames = LinkedBlockingQueue<Frame>()
    }

    val limits = config.limits()
    @Volatile private var session: Session? = null
    private val nextStream = AtomicInteger(1)
    private val streams = ConcurrentHashMap<Int, Stream>()
    private val sockets = ConcurrentHashMap<Int, BrowserSocket>()
    private val pendingSockets = ConcurrentHashMap<Int, LinkedBlockingQueue<Frame>>()
    private val sendLock = Any()

    override fun onWebSocketOpen(session: Session) {
        this.session = session
        if (refusal != null) {
            logger.info("Tunnel $id refused: $refusal")
            session.close(4003, refusal, WsCallback.NOOP)
            return
        }
        onOpen(this)
        sendHello()
    }

    fun sendHello() = runCatching { send(Frame.json(Frame.Type.HELLO, 0, hello())) }

    override fun onWebSocketBinary(payload: ByteBuffer, callback: WsCallback) {
        val frame = runCatching { Frame.decode(payload) }.getOrNull()
        callback.succeed()
        if (frame == null) return
        when (frame.type) {
            Frame.Type.RESPONSE, Frame.Type.RESPONSE_BODY, Frame.Type.RESPONSE_END, Frame.Type.RESET -> {
                streams[frame.stream]?.frames?.offer(frame)
                pendingSockets[frame.stream]?.offer(frame)
                if (frame.type == Frame.Type.RESET) sockets.remove(frame.stream)?.close(1011, "server reset")
            }
            Frame.Type.WS_OPENED -> pendingSockets[frame.stream]?.offer(frame)
            Frame.Type.WS_TEXT -> sockets[frame.stream]?.let { limits.consume(frame.payload.size); it.sendText(frame.text()) }
            Frame.Type.WS_BINARY -> sockets[frame.stream]?.let { limits.consume(frame.payload.size); it.sendBinary(frame.payload) }
            Frame.Type.WS_CLOSE -> sockets.remove(frame.stream)?.let { socket ->
                val close = frame.json<WsClose>()
                socket.close(close.code, close.reason)
            }
            Frame.Type.NAME -> runCatching { frame.json<NameRequest>() }.getOrNull()?.let { onName(this, frame.stream, it) }
            else -> logger.fine("Tunnel $id sent an unexpected ${frame.type}")
        }
    }

    override fun onWebSocketClose(statusCode: Int, reason: String?) = closed()

    override fun onWebSocketError(cause: Throwable) {
        logger.fine("Tunnel $id error: ${cause.message}")
        closed()
    }

    private fun closed() {
        if (refusal != null) return
        onClose(this)
        val reset = { stream: Int -> Frame(Frame.Type.RESET, stream) }
        streams.values.forEach { it.frames.offer(reset(it.id)) }
        pendingSockets.forEach { (stream, queue) -> queue.offer(reset(stream)) }
        sockets.values.forEach { it.close(1001, "server disconnected") }
        sockets.clear()
    }

    fun close(code: Int, reason: String) {
        session?.close(code, reason, WsCallback.NOOP)
    }

    /** Null past [TunnelServerConfig.maxStreamsPerTunnel]: the browser gets a 503. */
    fun openStream(): Stream? {
        if (streams.size + sockets.size >= config.maxStreamsPerTunnel) return null
        return Stream(nextStream.getAndIncrement()).also { streams[it.id] = it }
    }

    fun closeStream(id: Int) {
        streams.remove(id)
    }

    /** Blocks until the frame is written: a slow plugin slows its browser, not the tunnel server's memory. */
    fun send(frame: Frame) {
        val session = session ?: throw IllegalStateException("tunnel $id is not open")
        synchronized(sendLock) {
            val done = WsCallback.Completable()
            session.sendBinary(frame.encode(), done)
            done.get(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        }
    }

    /**
     * A browser asks for a WebSocket on this tunnel: the plugin opens it on its own web port
     * first, and the browser gets the same answer (101, or the server's refusal).
     */
    fun openSocket(request: Request, response: Response, callback: Callback): Any? {
        if (streams.size + sockets.size >= config.maxStreamsPerTunnel || !limits.allowRequest()) {
            Response.writeError(request, response, callback, 429)
            return null
        }
        val stream = nextStream.getAndIncrement()
        val answers = LinkedBlockingQueue<Frame>()
        pendingSockets[stream] = answers
        try {
            send(Frame.json(Frame.Type.WS_OPEN, stream, RequestHead("GET", TunnelServer.pathAndQuery(request), TunnelServer.forwardedHeaders(request, config))))
            val answer = answers.poll(OPEN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            val head = answer?.takeIf { it.type == Frame.Type.WS_OPENED }?.json<ResponseHead>()
            if (head == null || head.status != 101) {
                if (answer == null) runCatching { send(Frame(Frame.Type.RESET, stream)) }
                Response.writeError(request, response, callback, head?.status?.takeIf { it in 400..599 } ?: 502)
                return null
            }
            head.headers.firstOrNull { it[0].equals("Sec-WebSocket-Protocol", ignoreCase = true) }?.let {
                (response as ServerUpgradeResponse).acceptedSubProtocol = it[1]
            }
            return BrowserSocket(stream, this).also { sockets[stream] = it }
        } catch (e: Exception) {
            Response.writeError(request, response, callback, 502)
            return null
        } finally {
            pendingSockets.remove(stream)
        }
    }

    internal fun browserClosed(stream: Int, code: Int, reason: String?) {
        if (sockets.remove(stream) != null) runCatching { send(Frame.json(Frame.Type.WS_CLOSE, stream, WsClose(code, reason.orEmpty()))) }
    }

    private companion object {
        const val SEND_TIMEOUT_SECONDS = 30L
        const val OPEN_TIMEOUT_SECONDS = 15L
    }
}

/** A browser WebSocket bridged to the plugin's, through [tunnel] as stream [stream]. */
class BrowserSocket(private val stream: Int, private val tunnel: TunnelSession) : Session.Listener.AutoDemanding {
    @Volatile private var session: Session? = null
    /** What the server sends between its own open and the browser's: kept, then sent in order. */
    private val early = mutableListOf<() -> Unit>()

    override fun onWebSocketOpen(session: Session) {
        synchronized(early) {
            this.session = session
            early.forEach { it() }
            early.clear()
        }
    }

    override fun onWebSocketText(message: String) {
        tunnel.limits.consume(message.length)
        runCatching { tunnel.send(Frame(Frame.Type.WS_TEXT, stream, message.toByteArray())) }
    }

    override fun onWebSocketBinary(payload: ByteBuffer, callback: WsCallback) {
        val bytes = ByteArray(payload.remaining()).also { payload.get(it) }
        callback.succeed()
        tunnel.limits.consume(bytes.size)
        runCatching { tunnel.send(Frame(Frame.Type.WS_BINARY, stream, bytes)) }
    }

    override fun onWebSocketClose(statusCode: Int, reason: String?) = tunnel.browserClosed(stream, statusCode, reason)

    override fun onWebSocketError(cause: Throwable) = tunnel.browserClosed(stream, 1011, cause.message)

    fun sendText(text: String) = whenOpen { it.sendText(text, WsCallback.NOOP) }

    fun sendBinary(bytes: ByteArray) = whenOpen { it.sendBinary(ByteBuffer.wrap(bytes), WsCallback.NOOP) }

    fun close(code: Int, reason: String) = whenOpen { it.close(if (code in 1000..4999 && code !in setOf(1005, 1006, 1015)) code else 1000, reason.take(120), WsCallback.NOOP) }

    private fun whenOpen(action: (Session) -> Unit) {
        synchronized(early) {
            val open = session
            if (open == null) early += { action(session!!) } else action(open)
        }
    }
}
