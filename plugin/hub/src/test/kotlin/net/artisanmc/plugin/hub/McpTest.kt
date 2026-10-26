package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Collections
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The MCP endpoint end to end (ADR `mcp-server`): OAuth, the six tools, and what they never do. */
class McpTest {
    private val mapper = ObjectMapper()
    private val sent: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())
    private val server = McpFixtures.server(sent)

    private val drafts = McpFixtures.Drafts()
    private val sessions = Sessions()
    private val grants = McpGrants()
    private val player = UUID.randomUUID()
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"),
        EditorApi.router(Servers(server), sessions, null, drafts = drafts, mcp = grants, version = "2.0.0"),
        sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newHttpClient()
    private lateinit var cookie: String
    private val base get() = "http://127.0.0.1:${hub.port}"

    @BeforeTest
    fun start() {
        sessions.onPermissions(grants::permissionsChanged)
        hub.start()
        val token = (sessions.issueLink(player, "Iban", EditorPermissions.ALL.toSet(), origin = "u-local") as Sessions.LinkResult.Issued).token
        cookie = "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
    }

    @AfterTest
    fun stop() = hub.stop()

    private class Answer(val status: Int, val body: JsonNode?, val headers: java.net.http.HttpHeaders)

    private fun http(method: String, path: String, body: String? = null, headers: Map<String, String> = emptyMap()): Answer {
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(URI("$base$path")).method(method, publisher).apply { headers.forEach(::header) }.build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        return Answer(response.statusCode(), runCatching { mapper.readTree(response.body()) }.getOrNull(), response.headers())
    }

    private fun editor(method: String, path: String, body: Any? = null) =
        http(method, path, body?.let(mapper::writeValueAsString), mapOf("Cookie" to cookie, "Content-Type" to "application/json"))

    private fun form(path: String, vararg fields: Pair<String, String>) = http(
        "POST", path, fields.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, Charsets.UTF_8)}" },
        mapOf("Content-Type" to "application/x-www-form-urlencoded"),
    )

    private var nextId = 1

    private fun rpc(token: String?, method: String, params: Any? = null, headers: Map<String, String> = emptyMap()): Answer {
        val message = mutableMapOf<String, Any?>("jsonrpc" to "2.0", "id" to nextId++, "method" to method)
        if (params != null) message["params"] = params
        val auth = token?.let { mapOf("Authorization" to "Bearer $it") }.orEmpty()
        return http("POST", McpRoutes.PATH, mapper.writeValueAsString(message), mapOf("Content-Type" to "application/json") + auth + headers)
    }

    private fun tool(token: String, name: String, vararg args: Pair<String, Any?>): JsonNode {
        val answer = rpc(token, "tools/call", mapOf("name" to name, "arguments" to args.toMap()))
        assertEquals(200, answer.status, answer.body.toString())
        return answer.body!!["result"]
    }

    private val verifier = "v".repeat(20) + UUID.randomUUID().toString().replace("-", "")
    private val redirect = "https://claude.ai/api/mcp/auth_callback"

    private fun registerClient(): String {
        val answer = http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("client_name" to "Claude", "redirect_uris" to listOf(redirect))))
        assertEquals(201, answer.status)
        return answer.body!!["client_id"].asText()
    }

    /** Register, authorize, consent, code: what a client and the player do, in that order. */
    private fun code(clientId: String = registerClient(), challenge: String = McpGrants.challenge(verifier)): String {
        val authorize = http("GET", "${OAuthRoutes.AUTHORIZE}?response_type=code&client_id=$clientId&redirect_uri=${URLEncoder.encode(redirect, Charsets.UTF_8)}&state=xyz&code_challenge=$challenge&code_challenge_method=S256")
        assertEquals(302, authorize.status)
        val consent = authorize.headers.firstValue("Location").get()
        assertTrue(consent.startsWith(OAuthRoutes.CONSENT_PAGE + "?"), consent)
        val query = consent.substringAfter('?').split('&').associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), Charsets.UTF_8) }
        assertEquals("Claude", editor("GET", "${OAuthRoutes.CONSENT}?client_id=$clientId&redirect_uri=${URLEncoder.encode(redirect, Charsets.UTF_8)}").body!!["client"]["name"].asText())
        val approved = editor("POST", OAuthRoutes.CONSENT, query + ("approve" to true))
        assertEquals(200, approved.status)
        val back = approved.body!!["redirect"].asText()
        assertTrue(back.startsWith("$redirect?code="), back)
        assertTrue("state=xyz" in back)
        return back.substringAfter("code=").substringBefore('&')
    }

    private fun tokens(clientId: String = registerClient()): Pair<String, String> {
        val code = code(clientId)
        val answer = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to verifier)
        assertEquals(200, answer.status, answer.body.toString())
        assertEquals("Bearer", answer.body!!["token_type"].asText())
        return answer.body["access_token"].asText() to answer.body["refresh_token"].asText()
    }

    @Test
    fun `without a token, a client is told where to sign in`() {
        val answer = rpc(null, "initialize")
        assertEquals(401, answer.status)
        assertTrue(answer.headers.firstValue("WWW-Authenticate").get().contains("resource_metadata=\"$base${OAuthRoutes.RESOURCE_METADATA}\""))
        val resource = http("GET", OAuthRoutes.RESOURCE_METADATA).body!!
        assertEquals("$base/mcp", resource["resource"].asText())
        val metadata = http("GET", OAuthRoutes.SERVER_METADATA).body!!
        assertEquals(base, metadata["issuer"].asText())
        assertEquals(listOf("S256"), metadata["code_challenge_methods_supported"].map { it.asText() })
        assertEquals("$base${OAuthRoutes.REGISTER}", metadata["registration_endpoint"].asText())
        assertEquals(401, rpc("amcp_forged", "ping").status)
    }

    @Test
    fun `a client the player approved lists six tools, none of which deploys`() {
        val (access, _) = tokens()
        val init = rpc(access, "initialize", mapOf("protocolVersion" to "2025-06-18", "capabilities" to emptyMap<String, Any>(), "clientInfo" to mapOf("name" to "t", "version" to "1")))
        assertEquals("2025-06-18", init.body!!["result"]["protocolVersion"].asText())
        val notification = http("POST", McpRoutes.PATH, """{"jsonrpc":"2.0","method":"notifications/initialized"}""", mapOf("Authorization" to "Bearer $access"))
        assertEquals(202, notification.status)
        val names = rpc(access, "tools/list").body!!["result"]["tools"].map { it["name"].asText() }
        assertEquals(listOf("artisan_overview", "list_documents", "read_document", "get_kind_guide", "start_draft", "write_document"), names)
        assertTrue(names.none { "publish" in it || "deploy" in it })
        assertEquals(-32601, rpc(access, "resources/list").body!!["error"]["code"].asInt())
        assertEquals(405, http("GET", McpRoutes.PATH, headers = mapOf("Authorization" to "Bearer $access")).status)
    }

    @Test
    fun `a draft written through the MCP endpoint is checked, kept as the player's, and never published`() {
        val (access, _) = tokens()
        val overview = tool(access, "artisan_overview")["structuredContent"]
        assertEquals("u-local.shop", overview["servers"][0]["projects"][0].asText())
        val docs = tool(access, "list_documents", "project" to "u-local.shop")["structuredContent"]
        assertEquals("menus/shop.yml", docs["documents"][0]["path"].asText())
        assertEquals("menu", docs["documents"][0]["kind"].asText())

        val started = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: boutique")["structuredContent"]
        val draftId = started["draft_id"].asText()
        val stored = mapper.readTree(drafts.rows.getValue(draftId))
        assertEquals("ai", stored["source"].asText())
        assertEquals(player.toString(), stored["ownerId"].asText())

        val refused = tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to "schema: menu/v1\nbad: 1\n")
        assertTrue(refused["isError"].asBoolean())
        assertEquals("schema", refused["structuredContent"]["problems"][0]["stage"].asText())
        assertNull(mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]["menus/vip.yml"])

        val written = tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to "schema: menu/v1\n")
        assertFalse(written.has("isError"), written.toString())
        val tree = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]
        assertEquals("schema: menu/v1\n", tree["menus/vip.yml"].asText())
        assertEquals("a: b\n", tree["lang/en.yml"].asText())
        val read = tool(access, "read_document", "project" to "u-local.shop", "path" to "menus/vip.yml", "draft_id" to draftId)
        assertEquals("schema: menu/v1\n", read["structuredContent"]["content"].asText())

        // The check sees the draft's changes against what the server runs, not the file alone.
        val check = sent.last { it["type"] == "documents_check" }
        assertEquals("shop", check["project_id"])
        assertEquals("active", mapper.readTree(drafts.rows.getValue(draftId))["status"].asText())
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" })
    }

    @Test
    fun `the draft actions of the MCP endpoint leave the disk alone, by construction`() {
        assertEquals(setOf("list", "read", "create", "update"), McpProjects.DRAFT_ACTIONS)
        val principal = McpPrincipal(player, "Iban", EditorPermissions.ALL.toSet())
        val projects = McpProjects(Servers(server), null, drafts)
        for (action in listOf("publish", "discard", "write_blob")) {
            assertFailsWith<IllegalArgumentException> { projects.draft(principal, ProjectRef(server, "shop"), action) }
        }
        // No MCP or assistant source names a message that writes to a server's disk.
        val dir = listOf("src/main/kotlin/net/artisanmc/plugin/hub", "hub/src/main/kotlin/net/artisanmc/plugin/hub").map(::File).first { it.isDirectory }
        val sources = dir.listFiles { f -> f.name.startsWith("Mcp") || f.name.startsWith("Ai") || f.name.startsWith("Anthropic") }!!
        assertTrue(sources.size >= 8)
        for (file in sources) {
            val text = file.readText()
            for (forbidden in listOf("project_write", "project_draft_publish", "\"publish\"", "template_copy", "project_delete", "project_rename")) {
                assertFalse(forbidden in text, "${file.name} names $forbidden")
            }
        }
    }

    @Test
    fun `revoking a client cuts it off on its next call`() {
        val (access, _) = tokens()
        assertEquals(200, rpc(access, "ping").status)
        val listed = editor("GET", OAuthRoutes.GRANTS).body!!["grants"]
        assertEquals("Claude", listed[0]["client"].asText())
        assertEquals(200, editor("DELETE", "${OAuthRoutes.GRANTS}/${listed[0]["id"].asText()}").status)
        assertEquals(401, rpc(access, "ping").status)
    }

    @Test
    fun `losing artisan editor edit cuts access, losing view ends the grant`() {
        val (access, _) = tokens()
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW)))
        val answer = rpc(access, "ping")
        assertEquals(403, answer.status)
        assertTrue(answer.headers.firstValue("WWW-Authenticate").get().contains("insufficient_scope"))
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW, EditorPermissions.EDIT, EditorPermissions.PUBLISH)))
        assertEquals(200, rpc(access, "ping").status)
        assertFalse(grants.grants(player).single().can(EditorPermissions.PUBLISH), "an MCP client never holds publish")
        sessions.refresh("u-local", mapOf(player to emptySet()))
        assertEquals(401, rpc(access, "ping").status)
        assertTrue(grants.grants(player).isEmpty())
    }

    @Test
    fun `a code needs its verifier, works once, and a refresh token rotates`() {
        val clientId = registerClient()
        val code = code(clientId)
        val wrong = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to "w".repeat(43))
        assertEquals("invalid_grant", wrong.body!!["error"].asText())
        // A wrong verifier burns the code.
        val retry = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to verifier)
        assertEquals("invalid_grant", retry.body!!["error"].asText())

        val (access, refresh) = tokens(clientId)
        val rotated = form(OAuthRoutes.TOKEN, "grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to clientId)
        assertEquals(200, rotated.status)
        assertEquals(401, rpc(access, "ping").status)
        assertEquals(200, rpc(rotated.body!!["access_token"].asText(), "ping").status)
        assertEquals("invalid_grant", form(OAuthRoutes.TOKEN, "grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to clientId).body!!["error"].asText())
    }

    @Test
    fun `registration takes https or loopback redirects only`() {
        for (uri in listOf("http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag")) {
            val answer = http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("redirect_uris" to listOf(uri))))
            assertEquals(400, answer.status, uri)
        }
        assertEquals(201, http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("redirect_uris" to listOf("http://127.0.0.1:6274/oauth/callback")))).status)
        // An unknown client is never redirected to: the editor page says so.
        val unknown = http("GET", "${OAuthRoutes.AUTHORIZE}?client_id=nope&redirect_uri=https://evil.example/cb")
        assertEquals("${OAuthRoutes.CONSENT_PAGE}?error=invalid_client", unknown.headers.firstValue("Location").get())
    }

    @Test
    fun `another site cannot use the editor cookie on the MCP endpoint or the consent`() {
        val foreign = mapOf("Cookie" to cookie, "Origin" to "https://evil.example")
        assertEquals(401, rpc(null, "ping", headers = foreign).status)
        assertEquals(200, rpc(null, "ping", headers = mapOf("Cookie" to cookie)).status)
        val clientId = registerClient()
        val consent = http("POST", OAuthRoutes.CONSENT, mapper.writeValueAsString(mapOf("client_id" to clientId, "redirect_uri" to redirect, "approve" to true, "code_challenge" to McpGrants.challenge(verifier))),
            foreign + ("Content-Type" to "application/json"))
        assertEquals(403, consent.status)
        assertNotNull(grants.client(clientId))
        assertTrue(grants.grants(player).isEmpty())
    }
}
