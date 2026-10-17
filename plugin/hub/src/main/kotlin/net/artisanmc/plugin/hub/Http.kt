package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.eclipse.jetty.http.HttpCookie
import org.eclipse.jetty.http.HttpHeader
import org.eclipse.jetty.io.Content
import org.eclipse.jetty.server.Request
import org.eclipse.jetty.server.Response
import org.eclipse.jetty.util.Callback
import org.eclipse.jetty.util.Fields

/** An HTTP request in flight: what it carries, and the single response to give. */
class Call(
    val request: Request,
    private val response: Response,
    private val callback: Callback,
    val params: Map<String, String>,
    val session: EditorSession?,
) {
    val method: String get() = request.method
    val path: String get() = Request.getPathInContext(request)

    private val query: Fields by lazy { Request.extractQueryParameters(request) }

    fun query(name: String): String? = query.getValue(name)

    fun cookie(name: String): String? = Request.getCookies(request).firstOrNull { it.name == name }?.value

    fun header(name: String): String? = request.headers.get(name)

    fun body(): JsonNode? = runCatching { mapper.readTree(Content.Source.asString(request)) }.getOrNull()

    /** The raw body, or null beyond [limit] bytes. */
    fun bytes(limit: Int): ByteArray? {
        if (request.length > limit) return null
        val buffer = Content.Source.asByteBuffer(request)
        if (buffer.remaining() > limit) return null
        return ByteArray(buffer.remaining()).also { buffer.get(it) }
    }

    fun json(body: Any?, status: Int = 200) = send(status, "application/json", mapper.writeValueAsBytes(body))

    fun error(status: Int, code: String, message: String? = null) =
        json(if (message == null) mapOf("error" to code) else mapOf("error" to code, "message" to message), status)

    fun send(status: Int, contentType: String, bytes: ByteArray, cacheControl: String = "no-store", headers: Map<String, String> = emptyMap()) {
        response.status = status
        // A request body left unread makes Jetty drop the connection; say so, or the client reuses it and fails.
        if (status >= 400 && request.length != 0L) response.headers.put(HttpHeader.CONNECTION, "close")
        response.headers.put(HttpHeader.CONTENT_TYPE, contentType)
        response.headers.put(HttpHeader.CACHE_CONTROL, cacheControl)
        headers.forEach { (name, value) -> response.headers.put(name, value) }
        response.write(true, java.nio.ByteBuffer.wrap(bytes), callback)
    }

    fun setCookie(cookie: HttpCookie) = Response.addCookie(response, cookie)

    fun redirect(location: String) {
        response.status = 302
        response.headers.put(HttpHeader.LOCATION, location)
        response.headers.put(HttpHeader.CACHE_CONTROL, "no-store")
        callback.succeeded()
    }

    companion object {
        val mapper = ObjectMapper()
    }
}

/** Routes like `GET /api/v1/projects/:id/files`: `:name` segments become parameters. */
class Router {
    private class Route(val method: String, val segments: List<String>, val permission: String?, val handler: (Call) -> Unit)

    private val routes = mutableListOf<Route>()

    /** Null [permission]: public route. Otherwise, a session holding that permission. */
    fun on(method: String, pattern: String, permission: String?, handler: (Call) -> Unit) {
        routes += Route(method, split(pattern), permission, handler)
    }

    fun match(method: String, path: String): Match? {
        val segments = split(path)
        for (route in routes) {
            if (route.method != method || !fits(route.segments, segments)) continue
            val params = HashMap<String, String>()
            if (route.segments.last() == "*") {
                params["*"] = segments.drop(route.segments.size - 1).joinToString("/") { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
            }
            val matches = route.segments.indices.all { i ->
                val expected = route.segments[i]
                if (expected == "*") true
                else if (expected.startsWith(":")) {
                    params[expected.substring(1)] = java.net.URLDecoder.decode(segments[i], Charsets.UTF_8)
                    true
                } else expected == segments[i]
            }
            if (matches) return Match(route.permission, params, route.handler)
        }
        return null
    }

    fun knows(path: String): Boolean {
        val segments = split(path)
        return routes.any { r -> fits(r.segments, segments) && r.segments.indices.all { r.segments[it].startsWith(":") || r.segments[it] == "*" || r.segments[it] == segments[it] } }
    }

    /** A trailing `*` takes the rest of the path, at least one segment. */
    private fun fits(pattern: List<String>, segments: List<String>) =
        if (pattern.lastOrNull() == "*") segments.size >= pattern.size else segments.size == pattern.size

    class Match(val permission: String?, val params: Map<String, String>, val handler: (Call) -> Unit)

    private fun split(path: String) = path.trim('/').split('/').filter { it.isNotEmpty() }
}
