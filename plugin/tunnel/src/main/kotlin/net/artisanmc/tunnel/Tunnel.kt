package net.artisanmc.tunnel

import java.security.MessageDigest

/** What both ends of a tunnel agree on, besides [Frame]. */
object Tunnel {
    /** Sent by the plugin in [VERSION_HEADER]; the tunnel server refuses another major. */
    const val VERSION = "1.0"
    const val VERSION_HEADER = "X-Artisan-Tunnel-Version"
    /** Optional code a private tunnel server asks for (`TUNNEL_ACCESS_CODE`). */
    const val ACCESS_HEADER = "X-Artisan-Tunnel-Access"
    /** Where a plugin opens its tunnel, on the tunnel server's own host. */
    const val CONNECT_PATH = "/tunnel"

    /**
     * Headers about one hop only, never passed through. The rest goes as is, `Host` included:
     * the server sees the browser's address, so its same-origin check holds.
     */
    val HOP_BY_HOP = setOf(
        "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade",
        "proxy-authorization", "proxy-authenticate", "content-length",
        "sec-websocket-key", "sec-websocket-accept", "sec-websocket-version", "sec-websocket-extensions",
    )

    /**
     * The tunnel's subdomain, derived from the secret the plugin keeps (`plugins/Artisan/tunnel-secret`):
     * stable across restarts, and nobody can claim it without the secret. The tunnel server stores nothing.
     */
    fun id(secret: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(secret.toByteArray())
        val alphabet = "abcdefghijklmnopqrstuvwxyz234567"
        val out = StringBuilder()
        var buffer = 0
        var bits = 0
        for (byte in digest) {
            buffer = (buffer shl 8) or (byte.toInt() and 0xFF)
            bits += 8
            while (bits >= 5 && out.length < ID_LENGTH) {
                out.append(alphabet[(buffer shr (bits - 5)) and 31])
                bits -= 5
            }
            if (out.length == ID_LENGTH) break
        }
        return out.toString()
    }

    fun major(version: String): String = version.substringBefore('.')

    private const val ID_LENGTH = 16
}
