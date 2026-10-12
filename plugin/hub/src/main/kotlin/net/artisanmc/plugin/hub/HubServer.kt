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
 * Le serveur web de l'éditeur : fichiers de l'éditeur, API, WebSocket `/ws/editor`.
 * Toute route de l'API exige une session ; une requête qui modifie quelque chose doit
 * venir de la même origine que la page.
 */
class HubServer(
    private val config: WebConfig,
    private val router: Router,
    private val sessions: Sessions,
    private val assets: EditorAssets,
    private val channel: EditorChannel,
    private val logger: Logger,
) {
    private var server: Server? = null

    val port: Int? get() = (server?.connectors?.firstOrNull() as? ServerConnector)?.localPort

    /** Faux si le port est pris ou refusé : le plugin tourne alors sans éditeur. */
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
                val session = sessions.find(Request.getCookies(request).firstOrNull { it.name == COOKIE }?.value)
                if (session == null || !session.can(EditorPermissions.VIEW) || !sameOrigin(request)) {
                    Response.writeError(request, response, callback, 403)
                    null
                } else channel.endpoint()
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
            val session = sessions.find(Request.getCookies(request).firstOrNull { it.name == COOKIE }?.value)
            if (request.method == "GET" && path.startsWith(LOGIN)) {
                login(Call(request, response, callback, emptyMap(), null), path.removePrefix(LOGIN))
                return true
            }
            val match = router.match(request.method, path)
            if (match == null) {
                val call = Call(request, response, callback, emptyMap(), session)
                if (path.startsWith("/api/")) call.error(if (router.knows(path)) 405 else 404, "not_found")
                else assets.serve(call)
                return true
            }
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
        val session = sessions.redeem(token) ?: return call.redirect("/?login=expired")
        call.setCookie(
            HttpCookie.build(COOKIE, session.id)
                .path("/")
                .httpOnly(true)
                .secure(call.request.isSecure)
                .sameSite(HttpCookie.SameSite.STRICT)
                .maxAge(Duration.between(java.time.Instant.now(), session.expiresAt).seconds)
                .build(),
        )
        call.redirect("/")
    }

    /** L'en-tête `Origin`, quand il est présent, doit désigner l'hôte qui répond. */
    private fun sameOrigin(request: Request): Boolean {
        val origin = request.headers.get("Origin") ?: return true
        val host = request.headers.get("Host") ?: return false
        val uri = runCatching { URI(origin) }.getOrNull() ?: return false
        val originHost = if (uri.port == -1) uri.host else "${uri.host}:${uri.port}"
        return originHost.equals(host, ignoreCase = true)
    }

    companion object {
        const val COOKIE = "artisan_session"
        const val LOGIN = "/login/"
    }
}
