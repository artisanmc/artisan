package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The editor's imports screen: what it reads and what it starts, relayed to the server. */
class ImportRoutesTest {
    private val sent = mutableListOf<Map<String, Any?>>()
    private var protocol = net.artisanmc.plugin.protocol.ProtocolVersion.CURRENT
    private var answer: (Map<String, Any?>) -> Map<String, Any?> = { mapOf("ok" to true, "batch" to "b1") }
    private val live = object : EditorServer {
        override val id = "hub-1"
        override val online = true
        override val protocolVersion get() = protocol
        override val link = net.artisanmc.plugin.protocol.ServerLink { message ->
            sent += message
            CompletableFuture.completedFuture(answer(message))
        }
        override val label = "survie"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun announcement() = net.artisanmc.plugin.protocol.ServerAnnouncement.EMPTY
        override fun serverConfig() = null
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) {}
    }
    private val sessions = Sessions()
    private val router = Router().also { ImportRoutes(Servers(live), Relay(null), null).register(it) }
    private val hub = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), router, sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger())
    private val client = HttpClient.newHttpClient()
    private val mapper = ObjectMapper()

    @AfterTest
    fun stop() = hub.stop()

    private fun login(permissions: Set<String>): String {
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", permissions, "hub-1") as Sessions.LinkResult.Issued).token
        return client.send(HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/login/$token")).GET().build(), HttpResponse.BodyHandlers.ofString())
            .headers().firstValue("Set-Cookie").get().substringBefore(';')
    }

    private fun get(cookie: String) = client.send(
        HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/hub-1/imports")).header("Cookie", cookie).GET().build(),
        HttpResponse.BodyHandlers.ofString(),
    )

    private fun post(path: String, body: String, cookie: String) = client.send(
        HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/hub-1/imports/$path"))
            .header("Cookie", cookie).header("Origin", "http://127.0.0.1:${hub.port}").header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
        HttpResponse.BodyHandlers.ofString(),
    )

    @Test
    fun `the sources, the files and the runs are read from the server`() {
        hub.start()
        answer = {
            mapOf(
                "ok" to true,
                "sources" to listOf(mapOf("id" to "auctions:json", "label" to "Auctions file", "module" to "auctions", "reads_file" to true, "conflicts" to listOf("zAuctionHouse"), "conflict_running" to "zAuctionHouse")),
                "files" to listOf("listings.json"),
                "active" to listOf(mapOf("batch" to "b2", "source" to "auctions:json", "module" to "auctions", "action" to "apply", "started_at" to 5L, "target" to null)),
                "runs" to listOf(
                    mapOf(
                        "batch" to "b1", "source" to "auctions:json", "module" to "auctions", "action" to "plan", "applied" to false, "actor" to "Iban", "at" to 4L, "target" to null,
                        "report" to mapOf(
                            "dry_run" to true, "batch" to null, "counts" to listOf(mapOf("kind" to "listings", "label" to "Listings", "count" to 2)),
                            "already_imported" to 1, "rejected" to listOf(mapOf("source_id" to "7", "code" to "active_bid", "message" to "has a bid")),
                            "blockers" to emptyList<String>(), "notes" to listOf("n"),
                        ),
                    ),
                    mapOf("batch" to "b0", "source" to "auctions:json", "module" to "auctions", "action" to "apply", "applied" to true, "actor" to "Iban", "at" to 3L, "target" to null, "report" to mapOf("failed" to "boom")),
                ),
            )
        }
        val reply = get(login(setOf(EditorPermissions.CONFIG)))
        assertEquals(200, reply.statusCode())
        val json = mapper.readTree(reply.body())
        assertEquals(mapOf("type" to "imports_fetch"), sent.single())
        assertEquals(true, json.path("sources")[0].path("readsFile").asBoolean())
        assertEquals("zAuctionHouse", json.path("sources")[0].path("conflictRunning").asText())
        assertEquals("listings.json", json.path("files")[0].asText())
        assertEquals(5, json.path("active")[0].path("startedAt").asLong())
        val report = json.path("runs")[0].path("report")
        assertEquals(true, report.path("dryRun").asBoolean())
        assertEquals(1, report.path("alreadyImported").asInt())
        assertEquals("7", report.path("rejected")[0].path("sourceId").asText())
        assertEquals(2, report.path("counts")[0].path("count").asInt())
        assertEquals("boom", json.path("runs")[1].path("report").path("failed").asText())
    }

    @Test
    fun `a run is started under the session's name and answered before it ends`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.CONFIG))
        val reply = post("run", """{"source":"auctions:json","file":"listings.json","confirm":true,"lang":"fr"}""", cookie)
        assertEquals(202, reply.statusCode())
        assertEquals("b1", mapper.readTree(reply.body()).path("batch").asText())
        assertEquals(
            mapOf("type" to "import_start", "actor" to "Iban", "action" to "run", "source" to "auctions:json", "file" to "listings.json", "confirm" to true, "lang" to "fr"),
            sent.single(),
        )
        sent.clear()
        assertEquals(202, post("rollback", """{"batch":"b1"}""", cookie).statusCode())
        assertEquals(mapOf("type" to "import_start", "actor" to "Iban", "action" to "rollback", "batch" to "b1", "confirm" to false, "lang" to "en"), sent.single())
        // A source that reads no file: none is sent, not even a null the server would read as a name.
        sent.clear()
        assertEquals(202, post("run", """{"source":"msquests:beautyquests"}""", cookie).statusCode())
        assertEquals(mapOf("type" to "import_start", "actor" to "Iban", "action" to "run", "source" to "msquests:beautyquests", "confirm" to false, "lang" to "en"), sent.single())
    }

    @Test
    fun `a refusal keeps its code, a wrong body never reaches the server`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.CONFIG))
        answer = { mapOf("ok" to false, "error" to "conflict_running", "message" to "zAuctionHouse") }
        val refused = post("run", """{"source":"auctions:zauctionhouse","confirm":true}""", cookie)
        assertEquals(409, refused.statusCode())
        assertEquals("zAuctionHouse", mapper.readTree(refused.body()).path("message").asText())
        answer = { mapOf("ok" to false, "error" to "busy", "message" to "auctions") }
        assertEquals(409, post("run", """{"source":"auctions:zauctionhouse"}""", cookie).statusCode())
        answer = { mapOf("ok" to false, "error" to "unknown_batch", "message" to "zz") }
        assertEquals(404, post("rollback", """{"batch":"zz"}""", cookie).statusCode())

        sent.clear()
        assertEquals(422, post("run", """{"source":"Not A Source"}""", cookie).statusCode())
        assertEquals(422, post("run", """{"source":"auctions:json","file":"../secret"}""", cookie).statusCode())
        assertEquals(422, post("rollback", """{"batch":""}""", cookie).statusCode())
        assertEquals(emptyList(), sent)
    }

    @Test
    fun `imports need the config permission, and a server that speaks them`() {
        hub.start()
        assertEquals(403, get(login(setOf(EditorPermissions.VIEW, EditorPermissions.EDIT, EditorPermissions.PUBLISH))).statusCode())
        assertEquals(403, post("run", """{"source":"auctions:json"}""", login(setOf(EditorPermissions.PUBLISH))).statusCode())
        protocol = "1.8"
        val cookie = login(setOf(EditorPermissions.CONFIG))
        assertEquals(501, get(cookie).statusCode())
        assertEquals(501, post("run", """{"source":"auctions:json"}""", cookie).statusCode())
        assertNull(sent.firstOrNull())
    }
}
