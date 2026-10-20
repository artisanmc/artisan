package net.artisanmc.tunnel

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import java.nio.ByteBuffer

/**
 * One binary WebSocket message between the tunnel server and a plugin: `[type:1][stream:4][payload]`.
 * A stream is one browser HTTP request or one browser WebSocket; the tunnel server numbers them.
 */
class Frame(val type: Type, val stream: Int, val payload: ByteArray = EMPTY) {
    enum class Type(val code: Int) {
        /** Tunnel server → plugin, stream 0, once the tunnel is accepted: [Hello]. */
        HELLO(0),
        /** Tunnel server → plugin: [RequestHead], then [REQUEST_BODY] chunks, then [REQUEST_END]. */
        REQUEST(1),
        REQUEST_BODY(2),
        REQUEST_END(3),
        /** Plugin → tunnel server: [ResponseHead], then [RESPONSE_BODY] chunks, then [RESPONSE_END]. */
        RESPONSE(4),
        RESPONSE_BODY(5),
        RESPONSE_END(6),
        /** Tunnel server → plugin: a browser asks to open a WebSocket, [RequestHead] (method GET). */
        WS_OPEN(7),
        /** Plugin → tunnel server: the server accepted it ([ResponseHead] with status 101) or not (its status). */
        WS_OPENED(8),
        WS_TEXT(9),
        WS_BINARY(10),
        /** Either way: [WsClose]. */
        WS_CLOSE(11),
        /** Either way: the stream is abandoned (browser gone, server error, tunnel closing). */
        RESET(12);

        companion object {
            private val byCode = entries.associateBy { it.code }
            fun of(code: Int): Type = byCode[code] ?: throw IllegalArgumentException("unknown frame type $code")
        }
    }

    fun encode(): ByteBuffer =
        ByteBuffer.allocate(HEADER + payload.size).put(type.code.toByte()).putInt(stream).put(payload).flip()

    fun text(): String = payload.toString(Charsets.UTF_8)

    inline fun <reified T> json(): T = mapper.readValue(payload)

    companion object {
        const val HEADER = 5
        /** Body chunks are cut at this size, so one frame never holds a whole upload. */
        const val CHUNK = 256 * 1024
        val EMPTY = ByteArray(0)
        val mapper: ObjectMapper = jacksonObjectMapper()

        fun decode(buffer: ByteBuffer): Frame {
            require(buffer.remaining() >= HEADER) { "frame too short" }
            val type = Type.of(buffer.get().toInt() and 0xFF)
            val stream = buffer.getInt()
            val payload = ByteArray(buffer.remaining()).also { buffer.get(it) }
            return Frame(type, stream, payload)
        }

        fun json(type: Type, stream: Int, value: Any): Frame = Frame(type, stream, mapper.writeValueAsBytes(value))
    }
}

/** What the tunnel server tells a plugin once its tunnel is accepted: the address browsers use. */
data class Hello(val url: String)

/** [path] holds the query string. Header names keep their case; a name may repeat. */
data class RequestHead(val method: String, val path: String, val headers: List<List<String>>)

data class ResponseHead(val status: Int, val headers: List<List<String>> = emptyList())

data class WsClose(val code: Int, val reason: String = "")
