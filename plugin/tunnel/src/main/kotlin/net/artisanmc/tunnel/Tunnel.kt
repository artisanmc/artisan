package net.artisanmc.tunnel

import java.security.MessageDigest

/** What both ends of a tunnel agree on, besides [Frame]. */
object Tunnel {
    /** Sent by the plugin in [VERSION_HEADER]; the tunnel server refuses another major. */
    const val VERSION = "1.0"
    const val VERSION_HEADER = "X-Artisan-Tunnel-Version"
    /** Optional code a private tunnel server asks for (`TUNNEL_ACCESS_CODE`). */
    const val ACCESS_HEADER = "X-Artisan-Tunnel-Access"
    /**
     * Servers of one network share an address (ADR `peer-servers`). A plugin names itself in this
     * header when it opens its tunnel; a request carrying it goes to that server only, else to the
     * one that answers the address.
     */
    const val MEMBER_HEADER = "X-Artisan-Tunnel-Member"
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
     * stable across restarts, and nobody can claim it without the secret. A name ([validName]) may stand
     * for it too, kept by the tunnel server.
     */
    fun id(secret: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(secret.toByteArray())
        val out = StringBuilder()
        var buffer = 0
        var bits = 0
        for (byte in digest) {
            buffer = (buffer shl 8) or (byte.toInt() and 0xFF)
            bits += 8
            while (bits >= 5 && out.length < ID_LENGTH) {
                out.append(ALPHABET[(buffer shr (bits - 5)) and 31])
                bits -= 5
            }
            if (out.length == ID_LENGTH) break
        }
        return out.toString()
    }

    fun major(version: String): String = version.substringBefore('.')

    /**
     * A name an address may take: 3 to 32 lowercase letters, digits and inner hyphens, never `--`
     * (`xn--` is an encoded name), and never the shape of an id: it would answer for someone's tunnel.
     */
    fun validName(name: String): Boolean =
        name.length in 3..32 && NAME.matches(name) && "--" !in name && !looksLikeId(name)

    fun looksLikeId(label: String): Boolean = label.length == ID_LENGTH && label.all { it in ALPHABET }

    private const val ID_LENGTH = 16
    private const val ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
    private val NAME = Regex("[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")
}
