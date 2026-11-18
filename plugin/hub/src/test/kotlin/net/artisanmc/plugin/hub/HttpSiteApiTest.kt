package net.artisanmc.plugin.hub

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** [HttpSiteApi] against a stand-in for the site: the paths, the bearer, what each status means. */
class HttpSiteApiTest {
    private val seen = mutableListOf<String>()
    private var tokenStatus = 202
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/api/link/start/") { e ->
            seen += "${e.requestMethod} ${e.requestURI} ${String(e.requestBody.readAllBytes())}"
            e.reply(200, """{"device_code":"dev-1","user_code":"ABCD-EFGH","verification_url":"https://site.test/link/?code=ABCD-EFGH","expires_in":600,"interval":5}""")
        }
        createContext("/api/link/token/") { e ->
            seen += "${e.requestMethod} ${e.requestURI} ${String(e.requestBody.readAllBytes())}"
            e.reply(tokenStatus, if (tokenStatus == 200) """{"token":"arts_abc"}""" else """{"status":"pending"}""")
        }
        createContext("/api/updates/") { e ->
            seen += "${e.requestMethod} ${e.requestURI} ${e.requestHeaders.getFirst("Authorization")}"
            if (e.requestHeaders.getFirst("Authorization") == "Bearer arts_abc") e.reply(200, """{"channel":"dev","modules":[{"id":"artisan"}]}""")
            else e.reply(401, """{"error":"not linked"}""")
        }
        start()
    }
    private val api = HttpSiteApi("http://127.0.0.1:${server.address.port}", "1.2.3")

    private fun HttpExchange.reply(status: Int, body: String) {
        val bytes = body.toByteArray()
        sendResponseHeaders(status, bytes.size.toLong())
        responseBody.use { it.write(bytes) }
    }

    @AfterTest
    fun stop() = server.stop(0)

    @Test
    fun `the link is asked for, then collected once approved`() {
        val started = api.startLink("survie")
        assertEquals(SiteApi.Started("dev-1", "ABCD-EFGH", "https://site.test/link/?code=ABCD-EFGH", 600, 5), started)
        assertEquals(SiteApi.Collected.Waiting, api.collect("dev-1"))
        tokenStatus = 410
        assertEquals(SiteApi.Collected.Gone, api.collect("dev-1"))
        tokenStatus = 200
        assertEquals(SiteApi.Collected.Linked("arts_abc"), api.collect("dev-1"))
        // The site redirects a path without its trailing slash, and a redirected POST loses its body.
        assertEquals("""POST /api/link/start/ {"name":"survie"}""", seen.first())
        assertEquals("""POST /api/link/token/ {"device_code":"dev-1"}""", seen.last())
    }

    @Test
    fun `updates carry the token, the channel and what is installed`() {
        val body = api.updates("arts_abc", "dev", mapOf("artisan" to "1.0.0-dev.3", "quests" to "1.2.0"))
        assertEquals("artisan", body.path("modules").first().path("id").asText())
        assertEquals("GET /api/updates/?channel=dev&installed=artisan%3A1.0.0-dev.3%2Cquests%3A1.2.0 Bearer arts_abc", seen.single())
    }

    @Test
    fun `a refused token and a site that is down are told apart`() {
        assertEquals("site_unlinked", assertFailsWith<SiteFailure> { api.updates("arts_old", "release", emptyMap()) }.code)
        server.stop(0)
        assertEquals("site_unreachable", assertFailsWith<SiteFailure> { api.updates("arts_abc", "release", emptyMap()) }.code)
        assertEquals("site_unreachable", assertFailsWith<SiteFailure> { api.startLink("survie") }.code)
    }
}
