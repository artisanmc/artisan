package net.artisanmc.plugin.hub

import org.eclipse.jetty.http.HttpCookie
import org.eclipse.jetty.server.Handler
import org.eclipse.jetty.server.Request
import org.eclipse.jetty.server.Response
import org.eclipse.jetty.server.Server
import org.eclipse.jetty.server.ServerConnector
import org.eclipse.jetty.util.Callback
import org.eclipse.jetty.util.thread.QueuedThreadPool
import org.eclipse.jetty.websocket.server.WebSocketUpgradeHandler
import java.net.URI
import java.time.Duration
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The editor's web server: editor files, API, WebSocket `/ws/editor`, and `/ws/plugin`
 * for the network's other servers when [plugins] is given.
 * Every API route requires a session; a request that changes something must come from
 * the same origin as the page.
 */
class HubServer(
    private val config: WebConfig,
    private val router: Router,
    private val sessions: Sessions,
    private val assets: EditorAssets,
    private val channel: EditorChannel,
    private val logger: Logger,
    private val plugins: PluginChannel? = null,
) {
    private var server: Server? = null

    val port: Int? get() = (server?.connectors?.firstOrNull() as? ServerConnector)?.localPort

    /** False if the port is taken or refused: the plugin then runs without the editor. */
    fun start(): Boolean {
        val threads = QueuedThreadPool(32, 2).apply { name = "artisan-web"; isDaemon = true }
        val jetty = Server(threads)
        val connector = ServerConnector(jetty).apply {
            port = config.port
            if (config.bind.isNotBlank()) host = config.bind
        }
        jetty.addConnector(connector)
        val sockets = WebSocketUpgradeHandler.from(jetty) { container ->
            container.idleTimeout = Duration.ofMinutes(5)
            container.addMapping("/ws/editor") { request, response, callback ->
                val session = sessions.find(sessionId(request))
                if (session == null || !session.can(EditorPermissions.VIEW) || !sameOrigin(request)) {
                    Response.writeError(request, response, callback, 403)
                    null
                } else channel.endpoint()
            }
            if (plugins != null) {
                container.addMapping("/ws/plugin") { _, _, _ -> plugins.endpoint() }
            }
        }
        sockets.handler = Routes()
        jetty.handler = sockets
        return try {
            jetty.start()
            server = jetty
            logger.info("[Artisan] Editor listening on port ${connector.localPort}")
            true
        } catch (e: Exception) {
            logger.warning("[Artisan] Editor disabled: cannot listen on ${config.bind.ifBlank { "*" }}:${config.port} (${e.message})")
            runCatching { jetty.stop() }
            false
        }
    }

    fun stop() {
        val jetty = server ?: return
        server = null
        channel.closeAll()
        try {
            jetty.stop()
        } catch (e: Exception) {
            logger.log(Level.WARNING, "[Artisan] Editor web server did not stop cleanly", e)
        }
    }

    private inner class Routes : Handler.Abstract() {
        override fun handle(request: Request, response: Response, callback: Callback): Boolean {
            val path = Request.getPathInContext(request)
            if (request.method == "GET" && path.startsWith(LOGIN)) {
                login(Call(request, response, callback, emptyMap(), null), path.removePrefix(LOGIN))
                return true
            }
            val match = router.match(request.method, path)
            if (match == null) {
                // The editor's files and an unknown route need no session: a page load is one lookup, for its first API call.
                val call = Call(request, response, callback, emptyMap(), null)
                if (path.startsWith("/api/")) call.error(if (router.knows(path)) 405 else 404, "not_found")
                else assets.serve(call)
                return true
            }
            val session = sessions.find(sessionId(request))
            val call = Call(request, response, callback, match.params, session)
            when {
                match.permission != null && session == null -> call.error(401, "unauthorized")
                match.permission != null && !session!!.can(match.permission) -> call.error(403, "forbidden")
                request.method != "GET" && !sameOrigin(request) -> call.error(403, "cross_origin")
                else -> try {
                    match.handler(call)
                } catch (e: Exception) {
                    logger.log(Level.WARNING, "[Artisan] ${request.method} $path failed", e)
                    call.error(500, "internal_error")
                }
            }
            return true
        }
    }

    private fun login(call: Call, token: String) {
        val session = sessions.redeem(token) ?: return call.redirect("/login?expired=1")
        val secure = secure(call.request)
        call.setCookie(
            HttpCookie.build(if (secure) SECURE_COOKIE else COOKIE, session.id)
                .path("/")
                .httpOnly(true)
                .secure(secure)
                .sameSite(HttpCookie.SameSite.STRICT)
                // The hub ends the session, the cookie only carries it: kept as long as browsers allow.
                .maxAge(Duration.ofDays(400).seconds)
                .build(),
        )
        call.redirect("/")
    }

    /**
     * HTTPS seen by the browser: Jetty's own TLS, or a proxy saying so (the editor tunnel, nginx).
     * A forged `X-Forwarded-Proto` only makes the forger's own cookie stricter.
     */
    private fun secure(request: Request) =
        request.isSecure || request.headers.get("X-Forwarded-Proto").equals("https", ignoreCase = true)

    /** The `__Host-` cookie first: a sibling subdomain can set `artisan_session`, never that one. */
    private fun sessionId(request: Request): String? {
        val cookies = Request.getCookies(request)
        return (cookies.firstOrNull { it.name == SECURE_COOKIE } ?: cookies.firstOrNull { it.name == COOKIE })?.value
    }

    /** The `Origin` header, when present, must name the answering host. */
    private fun sameOrigin(request: Request): Boolean {
        val origin = request.headers.get("Origin") ?: return true
        val host = request.headers.get("Host") ?: return false
        val uri = runCatching { URI(origin) }.getOrNull() ?: return false
        val originHost = if (uri.port == -1) uri.host else "${uri.host}:${uri.port}"
        return originHost.equals(host, ignoreCase = true)
    }

    companion object {
        const val COOKIE = "artisan_session"
        /**
         * Over HTTPS: the `__Host-` prefix makes browsers refuse it from any other host, so a page
         * on another subdomain of a shared domain (the editor tunnel) cannot overwrite it.
         */
        const val SECURE_COOKIE = "__Host-artisan_session"
        const val LOGIN = "/login/"
    }
}
