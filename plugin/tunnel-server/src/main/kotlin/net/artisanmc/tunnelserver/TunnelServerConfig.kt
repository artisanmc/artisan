package net.artisanmc.tunnelserver

/**
 * Read from the environment. A tunnel `<id>` answers on `<id>.<domain>`; the tunnel server itself
 * (the plugins' `/tunnel`, `/health`) on [domain].
 */
data class TunnelServerConfig(
    val domain: String,
    val port: Int = 8080,
    val bind: String = "",
    /** The scheme browsers see, in front of the TLS proxy: the address given to each plugin. */
    val publicScheme: String = "https",
    /** Empty: any plugin may open a tunnel. Otherwise, only those sending this code. */
    val accessCode: String = "",
    val maxBodyBytes: Long = 100L * 1024 * 1024,
    val maxStreamsPerTunnel: Int = 64,
    /** Paths never passed through: the resource pack goes to players, not over the tunnel server. */
    val blockedPrefixes: List<String> = listOf("/resource-pack/"),
    /** Browser requests per tunnel and per minute; 0: no limit. */
    val requestsPerMinute: Int = 600,
    /** Bandwidth per tunnel, both ways together; 0: no limit. */
    val bytesPerSecond: Long = 2L * 1024 * 1024,
    /** Volume per tunnel and per UTC day, both ways together; 0: no limit. */
    val bytesPerDay: Long = 2L * 1024 * 1024 * 1024,
    /** Tunnels open at once from one address; 0: no limit. */
    val tunnelsPerAddress: Int = 3,
    /**
     * The header the TLS proxy puts the client's address in (`CF-Connecting-IP` behind
     * Cloudflare). Empty: the connection's address. Never set it without such a proxy: anyone could forge it.
     */
    val clientIpHeader: String = "",
) {
    fun publicUrl(id: String) = "$publicScheme://$id.$domain"

    fun limits() = TunnelLimits(requestsPerMinute, bytesPerSecond, bytesPerDay)

    fun clientIp(request: org.eclipse.jetty.server.Request): String =
        clientIpHeader.takeIf { it.isNotBlank() }?.let { request.headers.get(it) }?.trim()?.ifEmpty { null }
            ?: org.eclipse.jetty.server.Request.getRemoteAddr(request)

    companion object {
        fun fromEnv(env: Map<String, String> = System.getenv()): TunnelServerConfig {
            val domain = env["TUNNEL_DOMAIN"]?.trim()?.lowercase()?.trimEnd('.')
                ?: error("TUNNEL_DOMAIN is required, e.g. tunnel.example.net")
            return TunnelServerConfig(
                domain = domain,
                port = env["TUNNEL_PORT"]?.toIntOrNull() ?: 8080,
                bind = env["TUNNEL_BIND"].orEmpty(),
                publicScheme = env["TUNNEL_PUBLIC_SCHEME"]?.ifBlank { null } ?: "https",
                accessCode = env["TUNNEL_ACCESS_CODE"].orEmpty(),
                maxBodyBytes = (env["TUNNEL_MAX_BODY_MB"]?.toLongOrNull() ?: 100L) * 1024 * 1024,
                maxStreamsPerTunnel = env["TUNNEL_MAX_STREAMS"]?.toIntOrNull() ?: 64,
                blockedPrefixes = env["TUNNEL_BLOCKED_PATHS"]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
                    ?: listOf("/resource-pack/"),
                requestsPerMinute = env["TUNNEL_REQUESTS_PER_MINUTE"]?.toIntOrNull() ?: 600,
                bytesPerSecond = (env["TUNNEL_BANDWIDTH_KBPS"]?.toLongOrNull() ?: 2048L) * 1024,
                bytesPerDay = (env["TUNNEL_DAILY_MB"]?.toLongOrNull() ?: 2048L) * 1024 * 1024,
                tunnelsPerAddress = env["TUNNEL_PER_ADDRESS"]?.toIntOrNull() ?: 3,
                clientIpHeader = env["TUNNEL_CLIENT_IP_HEADER"].orEmpty().trim(),
            )
        }
    }
}
