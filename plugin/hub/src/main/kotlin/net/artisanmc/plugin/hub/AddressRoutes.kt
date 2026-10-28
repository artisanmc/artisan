package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.CONFIG
import net.artisanmc.tunnel.NameResult
import java.net.URI
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** The editor's address on the tunnel server, and the name it may take there (ADR `editor-tunnel`). */
interface TunnelNames {
    /** The address browsers use now; null while disconnected. */
    val url: String?
    val name: String?
    /** False when the tunnel server keeps no names. */
    val names: Boolean
    fun requestName(name: String, check: Boolean): CompletableFuture<NameResult>
}

/**
 * `GET /api/v1/editor-address`: the address and its name; `POST` with `{name, check}` says whether a name is
 * free, or takes it (an empty name gives it back). Taking one hands back a sign-in link for the new address:
 * the session cookie stays on the old one.
 */
class AddressRoutes(private val tunnel: () -> TunnelNames?, private val sessions: Sessions) {
    fun register(router: Router) {
        router.on("GET", PATH, CONFIG) { call ->
            val current = tunnel() ?: return@on call.json(mapOf("tunnel" to false))
            val url = current.url
            call.json(mapOf(
                "tunnel" to true, "connected" to (url != null), "url" to url, "name" to current.name,
                "names" to current.names, "suffix" to url?.let(::suffix),
            ))
        }
        router.on("POST", PATH, CONFIG) { call ->
            val current = tunnel() ?: return@on call.error(404, "no_tunnel")
            val body = call.body() ?: return@on call.error(400, "invalid_body")
            val name = body.path("name").asText("").trim().lowercase()
            val check = body.path("check").asBoolean(false)
            val result = runCatching { current.requestName(name, check).get(WAIT_SECONDS, TimeUnit.SECONDS) }
                .getOrElse { NameResult(false, error = TunnelClient.OFFLINE) }
            if (!result.ok) {
                val status = when (result.error) {
                    "taken" -> 409
                    "too_many" -> 429
                    "unavailable", TunnelClient.OFFLINE -> 503
                    else -> 422
                }
                return@on call.error(status, result.error ?: "refused")
            }
            val session = call.session!!
            val login = result.url?.takeUnless { check }?.let { "$it${HubServer.LOGIN}${sessions.handOff(session)}" }
            call.json(mapOf("ok" to true, "name" to result.name, "url" to result.url, "login" to login))
        }
    }

    private companion object {
        const val PATH = "/api/v1/editor-address"
        const val WAIT_SECONDS = 12L

        /** `.artisanmc.app` for `https://abc.artisanmc.app`: what a name is followed by. */
        fun suffix(url: String): String? =
            runCatching { URI(url).host }.getOrNull()?.substringAfter('.', "")?.takeIf { it.isNotEmpty() }?.let { ".$it" }
    }
}
