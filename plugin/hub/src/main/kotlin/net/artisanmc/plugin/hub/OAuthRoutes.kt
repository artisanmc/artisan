package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.EDIT
import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import java.net.URI
import java.net.URLEncoder

/**
 * OAuth 2.1 for the MCP endpoint (ADR `mcp-server`): the metadata a client discovers (RFC 9728,
 * RFC 8414), registration (RFC 7591), authorization with PKCE, tokens. The consent itself is a
 * page of the editor (`/oauth/consent`): the player is signed in there as usual, and approves
 * through [CONSENT], a same-origin route like any other.
 */
class OAuthRoutes(private val grants: McpGrants) {
    fun register(router: Router) {
        for (path in listOf(RESOURCE_METADATA, "$RESOURCE_METADATA${McpRoutes.PATH}")) {
            router.on("GET", path, null, crossOrigin = true) { call ->
                cors(call)
                val base = base(call)
                call.json(mapOf(
                    "resource" to "$base${McpRoutes.PATH}",
                    "authorization_servers" to listOf(base),
                    "bearer_methods_supported" to listOf("header"),
                    "scopes_supported" to listOf(SCOPE),
                    "resource_name" to "Artisan",
                ))
            }
            router.on("OPTIONS", path, null, crossOrigin = true, ::preflight)
        }
        router.on("GET", SERVER_METADATA, null, crossOrigin = true) { call ->
            cors(call)
            val base = base(call)
            call.json(mapOf(
                "issuer" to base,
                "authorization_endpoint" to "$base$AUTHORIZE",
                "token_endpoint" to "$base$TOKEN",
                "registration_endpoint" to "$base$REGISTER",
                "response_types_supported" to listOf("code"),
                "grant_types_supported" to listOf("authorization_code", "refresh_token"),
                "code_challenge_methods_supported" to listOf("S256"),
                "token_endpoint_auth_methods_supported" to listOf("none"),
                "scopes_supported" to listOf(SCOPE),
            ))
        }
        router.on("OPTIONS", SERVER_METADATA, null, crossOrigin = true, ::preflight)
        router.on("POST", REGISTER, null, crossOrigin = true, ::registerClient)
        router.on("OPTIONS", REGISTER, null, crossOrigin = true, ::preflight)
        router.on("GET", AUTHORIZE, null, crossOrigin = true, ::authorize)
        router.on("POST", TOKEN, null, crossOrigin = true, ::token)
        router.on("OPTIONS", TOKEN, null, crossOrigin = true, ::preflight)

        // The editor's consent page and its list of connected apps: same-origin, signed in.
        router.on("GET", CONSENT, VIEW) { call ->
            val client = grants.client(call.query("client_id"))
            val redirect = call.query("redirect_uri")
            if (client == null || redirect == null || redirect !in client.redirectUris) return@on call.error(422, "invalid_client")
            val session = call.session!!
            call.json(mapOf(
                "client" to mapOf("name" to client.name, "redirectHost" to URI(redirect).host),
                "player" to session.playerName,
                "canEdit" to session.can(EDIT),
            ))
        }
        router.on("POST", CONSENT, EDIT) { call ->
            val body = call.body() ?: return@on call.error(422, "invalid_input")
            val client = grants.client(body.path("client_id").asText(""))
            val redirect = body.path("redirect_uri").asText("")
            if (client == null || redirect !in client.redirectUris) return@on call.error(422, "invalid_client")
            val state = body.path("state").asText("").ifEmpty { null }
            if (!body.path("approve").asBoolean(false)) return@on call.json(mapOf("redirect" to back(redirect, "error" to "access_denied", "state" to state)))
            val code = grants.approve(call.session!!, client, redirect, body.path("code_challenge").asText(""))
                ?: return@on call.error(422, "invalid_input")
            call.json(mapOf("redirect" to back(redirect, "code" to code, "state" to state, "iss" to base(call))))
        }
        router.on("GET", GRANTS, VIEW) { call ->
            call.json(mapOf("grants" to grants.grants(call.session!!.playerId).map { g ->
                mapOf("id" to g.id, "client" to g.clientName, "createdAt" to g.createdAt.toString(), "lastUsedAt" to g.lastUsedAt.toString())
            }))
        }
        router.on("DELETE", "$GRANTS/:grant", VIEW) { call ->
            if (grants.revoke(call.session!!.playerId, call.params.getValue("grant"))) call.json(mapOf("ok" to true))
            else call.error(404, "not_found")
        }
    }

    private fun registerClient(call: Call) {
        cors(call)
        val body = call.bytes(16 * 1024)?.let { runCatching { Call.mapper.readTree(it) }.getOrNull() }
            ?: return call.json(mapOf("error" to "invalid_client_metadata", "error_description" to "a JSON body is expected"), 400)
        val uris = body.path("redirect_uris").takeIf { it.isArray }?.map { it.asText("") }.orEmpty()
        val method = body.path("token_endpoint_auth_method").asText("none")
        if (method != "none") return call.json(mapOf("error" to "invalid_client_metadata", "error_description" to "only public clients (none)"), 400)
        when (val result = grants.register(body.path("client_name").asText(""), uris)) {
            is McpGrants.Registration.Refused -> call.json(mapOf("error" to result.error, "error_description" to result.description), 400)
            is McpGrants.Registration.Registered -> call.json(mapOf(
                "client_id" to result.client.id,
                "client_id_issued_at" to result.client.createdAt.epochSecond,
                "client_name" to result.client.name,
                "redirect_uris" to result.client.redirectUris,
                "token_endpoint_auth_method" to "none",
                "grant_types" to listOf("authorization_code", "refresh_token"),
                "response_types" to listOf("code"),
            ), 201)
        }
    }

    /**
     * The client sends the player here. Without a known client and redirect, nothing is sent
     * back to an address nobody registered: the editor page says what went wrong.
     */
    private fun authorize(call: Call) {
        val client = grants.client(call.query("client_id"))
        val redirect = call.query("redirect_uri") ?: client?.redirectUris?.singleOrNull()
        if (client == null || redirect == null || redirect !in client.redirectUris) return call.redirect("$CONSENT_PAGE?error=invalid_client")
        val state = call.query("state")
        val invalid = when {
            call.query("response_type") != "code" -> "unsupported_response_type"
            call.query("code_challenge_method") != "S256" || call.query("code_challenge").isNullOrEmpty() -> "invalid_request"
            else -> null
        }
        if (invalid != null) return call.redirect(back(redirect, "error" to invalid, "state" to state))
        call.redirect(CONSENT_PAGE + "?" + query(
            "client_id" to client.id, "redirect_uri" to redirect, "state" to state, "code_challenge" to call.query("code_challenge"),
        ))
    }

    private fun token(call: Call) {
        cors(call)
        val form = call.form() ?: return tokenError(call, "invalid_request")
        val clientId = form["client_id"].orEmpty()
        if (grants.client(clientId) == null) return tokenError(call, "invalid_client", 401)
        val tokens = when (form["grant_type"]) {
            "authorization_code" -> grants.exchange(form["code"].orEmpty(), clientId, form["redirect_uri"].orEmpty(), form["code_verifier"].orEmpty())
            "refresh_token" -> grants.refresh(form["refresh_token"].orEmpty(), clientId)
            else -> return tokenError(call, "unsupported_grant_type")
        } ?: return tokenError(call, "invalid_grant")
        call.json(mapOf(
            "access_token" to tokens.accessToken, "token_type" to "Bearer", "expires_in" to tokens.expiresIn,
            "refresh_token" to tokens.refreshToken, "scope" to SCOPE,
        ))
    }

    private fun tokenError(call: Call, error: String, status: Int = 400) = call.json(mapOf("error" to error), status)

    private fun back(redirect: String, vararg params: Pair<String, String?>): String =
        redirect + (if ('?' in redirect) "&" else "?") + query(*params)

    private fun query(vararg params: Pair<String, String?>) =
        params.filter { it.second != null }.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, Charsets.UTF_8)}" }

    companion object {
        const val RESOURCE_METADATA = "/.well-known/oauth-protected-resource"
        const val SERVER_METADATA = "/.well-known/oauth-authorization-server"
        const val REGISTER = "/oauth/register"
        const val AUTHORIZE = "/oauth/authorize"
        const val TOKEN = "/oauth/token"
        /** The editor's page (a route of the editor app, not of the API). */
        const val CONSENT_PAGE = "/oauth/consent"
        const val CONSENT = "/api/v1/oauth/consent"
        const val GRANTS = "/api/v1/user/mcp/grants"
        const val SCOPE = "artisan"

        /**
         * The address the client used: `X-Forwarded-*` from the editor tunnel or a proxy, else
         * the request's. A forged header only misleads the forger's own client.
         */
        fun base(call: Call): String {
            val proto = call.header("X-Forwarded-Proto")?.substringBefore(',')?.trim()
                ?: if (call.request.isSecure) "https" else "http"
            val host = call.header("X-Forwarded-Host")?.substringBefore(',')?.trim() ?: call.header("Host") ?: "localhost"
            return "$proto://$host"
        }

        /** Browser-based clients (MCP Inspector) call from their own page: any origin, never with cookies. */
        fun cors(call: Call) {
            call.addHeader("Access-Control-Allow-Origin", "*")
            call.addHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id")
        }

        fun preflight(call: Call) {
            cors(call)
            call.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            call.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID")
            call.addHeader("Access-Control-Max-Age", "600")
            call.send(204, "text/plain", ByteArray(0))
        }
    }
}
