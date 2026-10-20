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
) {
    fun publicUrl(id: String) = "$publicScheme://$id.$domain"

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
            )
        }
    }
}
