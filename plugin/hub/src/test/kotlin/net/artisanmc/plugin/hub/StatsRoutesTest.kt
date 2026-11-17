package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.modules.api.stats.StatStorage
import net.artisanmc.plugin.stats.BreakdownQuery
import net.artisanmc.plugin.stats.BreakdownRow
import net.artisanmc.plugin.stats.CatalogEntry
import net.artisanmc.plugin.stats.EventRow
import net.artisanmc.plugin.stats.EventsPage
import net.artisanmc.plugin.stats.EventsQuery
import net.artisanmc.plugin.stats.Granularity
import net.artisanmc.plugin.stats.SeriesPoint
import net.artisanmc.plugin.stats.SeriesQuery
import net.artisanmc.plugin.stats.StatsReader
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.ZoneId
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class StatsRoutesTest {
    private val alice = UUID.fromString("00000000-0000-0000-0000-00000000000a")
    private val asked = mutableListOf<Any>()
    private val reader = object : StatsReader {
        override fun catalog(server: Int) = listOf(CatalogEntry("core:menu_open", true, false), CatalogEntry("quests:old", true, true))
        override fun series(server: Int, q: SeriesQuery): List<SeriesPoint> {
            asked += server to q
            return listOf(SeriesPoint(3600, Granularity.HOUR, 4, 6.0, 1.0, 2.0))
        }
        override fun breakdown(server: Int, q: BreakdownQuery): List<BreakdownRow> {
            asked += server to q
            return listOf(BreakdownRow("shop", 5, 5.0, 1.0, 1.0))
        }
        override fun actives(server: Int, q: SeriesQuery): net.artisanmc.plugin.stats.Actives {
            asked += server to q
            return net.artisanmc.plugin.stats.Actives(3, listOf(net.artisanmc.plugin.stats.ActivesPoint(3600, 2)))
        }
        override fun events(server: Int, q: EventsQuery): EventsPage {
            asked += server to q
            return EventsPage(listOf(EventRow(9, alice.toString(), "core:session", 1000, mapOf("a" to "b"), 12.5, """{"started_at":"1"}""")), 8)
        }
        override fun scan(server: Int, fromMs: Long, toMs: Long, events: Set<String>?, each: (net.artisanmc.plugin.stats.RawHit) -> Unit) {
            scans++
            raw.filter { it.at >= fromMs && it.at < toMs && (events == null || it.event in events) }.sortedBy { it.at }.forEach(each)
        }
    }
    private val raw = mutableListOf<net.artisanmc.plugin.stats.RawHit>()
    private var scans = 0
    private val savedJourneys = mutableMapOf<Int, String>()
    private var now = 40L * 86_400
    private var enabled = true
    private var store: StatsReader? = reader
    private val sessions = Sessions()
    private val servers = Servers(RemoteServer("hub-1", "survie", publicUrl = { "" }))
    private val access = StatsAccess(
        reader = { store },
        rowOf = { if (it == "hub-1") 7 else null },
        enabled = { enabled },
        declared = {
            listOf(
                StatEvent.builder("core:menu_open").dimensions("menu").build(),
                StatEvent.builder("core:first_join").storage(StatStorage.BOTH).build(),
            )
        },
        zone = { ZoneId.of("UTC") },
        journeys = {
            object : StatsJourneyStore {
                override fun read(server: Int) = savedJourneys[server]
                override fun write(server: Int, json: String) { savedJourneys[server] = json }
            }
        },
        now = { now },
        players = {
            object : StatsPlayers {
                override fun search(prefix: String, limit: Int) = listOf(alice to "Alice").filter { it.second.startsWith(prefix, ignoreCase = true) }
                override fun names(ids: Collection<UUID>) = listOf(alice to "Alice").filter { it.first in ids }
            }
        },
    )
    private val router = Router().also { StatsRoutes(servers, access).register(it) }
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"), router, sessions,
        EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()

    @AfterTest
    fun stop() = hub.stop()

    private fun login(permissions: Set<String>): String {
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", permissions, "hub-1") as Sessions.LinkResult.Issued).token
        val response = client.send(HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/login/$token")).GET().build(), HttpResponse.BodyHandlers.ofString())
        return response.headers().firstValue("Set-Cookie").get().substringBefore(';')
    }

    private fun get(path: String, cookie: String): HttpResponse<String> =
        client.send(HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/hub-1/stats/$path")).header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString())

    private fun json(response: HttpResponse<String>): JsonNode = Call.mapper.readTree(response.body())

    private fun send(method: String, path: String, cookie: String, body: String): HttpResponse<String> =
        client.send(
            HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/hub-1/stats/$path")).header("Cookie", cookie)
                .header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString(),
        )

    @Test
    fun `journeys are saved per server once validated`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        assertEquals(0, json(get("journeys", cookie)).path("journeys").size())
        val journey = """{"id":"onboarding","name":" Onboarding ","window_days":7,"goals":[{"name":"First quest","event":"quests:completed","dims":{"quest":"intro"}},{"name":"Shop","event":"core:menu_open"}]}"""
        assertEquals(200, send("PUT", "journeys", cookie, """{"journeys":[$journey]}""").statusCode())
        val saved = json(get("journeys", cookie)).path("journeys")[0]
        assertEquals("Onboarding", saved.path("name").asText())
        assertEquals("intro", saved.path("goals")[0].path("dims").path("quest").asText())
        assertEquals(true, savedJourneys.containsKey(7))
        for (bad in listOf(
            """{}""",
            """{"journeys":[{"id":"Bad Id","name":"x","window_days":7,"goals":[]}]}""",
            """{"journeys":[{"id":"a","name":"","window_days":7,"goals":[]}]}""",
            """{"journeys":[{"id":"a","name":"x","window_days":0,"goals":[]}]}""",
            """{"journeys":[{"id":"a","name":"x","window_days":7,"goals":[{"name":"g","event":"Not An Event"}]}]}""",
            """{"journeys":[{"id":"a","name":"x","window_days":7,"goals":[{"name":"g","event":"a:b","dims":{"Bad Key":"v"}}]}]}""",
            """{"journeys":[$journey,$journey]}""",
        )) assertEquals(422, send("PUT", "journeys", cookie, bad).statusCode(), bad)
        assertEquals("Onboarding", json(get("journeys", cookie)).path("journeys")[0].path("name").asText(), "a refused list replaces nothing")
        assertEquals(403, send("PUT", "journeys", login(setOf(EditorPermissions.VIEW)), """{"journeys":[]}""").statusCode())
    }

    @Test
    fun `a journey is computed for the arrivals of the period, and served again for a minute`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        val day = 86_400L
        fun hit(player: String, event: String, at: Long, dims: Map<String, String> = emptyMap(), details: String = "{}") {
            raw += net.artisanmc.plugin.stats.RawHit(player, event, at * 1000, dims, details)
        }
        hit("a", "core:first_join", 10 * day); hit("b", "core:first_join", 10 * day + 5)
        hit("a", "quests:completed", 10 * day + 120, mapOf("quest" to "intro"))
        hit("a", "core:session", 11 * day + 600, details = """{"started_at":"${(11 * day + 60) * 1000}"}""")
        hit("b", "core:menu_open", 10 * day + 30, mapOf("menu" to "jobs:main"))
        val body = """{"from":${9 * day},"to":${12 * day},"goals":[{"name":"First quest","event":"quests:completed","dims":{"quest":"intro"}}]}"""

        val reply = send("POST", "journey", cookie, body)
        assertEquals(200, reply.statusCode())
        val result = json(reply)
        assertEquals(2, result.path("arrivals").asInt())
        assertEquals("First quest", result.path("steps")[0].path("name").asText())
        assertEquals(1, result.path("steps")[0].path("players").asInt())
        assertEquals(120.0, result.path("steps")[0].path("median_seconds").asDouble())
        assertEquals(listOf(1, 2, 1), result.path("retention")[0].let { listOf(it.path("day").asInt(), it.path("eligible").asInt(), it.path("returned").asInt()) })
        assertEquals(1, result.path("cohorts").size())
        assertEquals(1, result.path("cohorts")[0].path("reached")[0].asInt())
        assertEquals(2, result.path("leavers").asInt())
        assertEquals("jobs:main", result.path("last_actions")[0].path("dimensions").path("menu").asText())
        assertEquals(7, result.path("away_days").asInt())

        val read = scans
        now += 30
        assertEquals(40 * day, json(send("POST", "journey", cookie, body)).path("computed_at").asLong())
        assertEquals(read, scans, "the same question within a minute is not read again")
        now += 60
        send("POST", "journey", cookie, body)
        assertEquals(read + 2, scans)

        for (bad in listOf(
            """{"from":5,"to":5}""",
            """{"from":0,"to":${100 * day}}""",
            """{"from":0,"to":10,"window_days":400}""",
            """{"from":0,"to":10,"goals":[{"name":"g"}]}""",
            "not json",
        )) assertEquals(422, send("POST", "journey", cookie, bad).statusCode(), bad)
    }

    @Test
    fun `statistics need their own permission, which editing does not give`() {
        hub.start()
        val editor = login(setOf(EditorPermissions.VIEW, EditorPermissions.EDIT, EditorPermissions.PUBLISH, EditorPermissions.CONFIG))
        assertEquals(403, get("catalog", editor).statusCode())
        assertEquals(200, get("catalog", login(setOf(EditorPermissions.VIEW, EditorPermissions.STATS))).statusCode())
        assertEquals(true, EditorPermissions.STATS in EditorPermissions.ALL)
    }

    @Test
    fun `the catalog lists stored and declared events with the shape their server declared`() {
        hub.start()
        val events = json(get("catalog", login(setOf(EditorPermissions.STATS)))).path("events")
        assertEquals(listOf("core:first_join", "core:menu_open", "quests:old"), events.map { it.path("event").asText() })
        // Declared, never recorded: listed as its declaration stores it.
        assertEquals(true, events[0].path("raw").asBoolean())
        assertEquals(true, events[0].path("bucketed").asBoolean())
        assertEquals(listOf("menu"), events[1].path("dimensions").map { it.asText() })
        assertEquals("counter", events[1].path("kind").asText())
        assertEquals(true, events[2].path("raw").asBoolean())
        assertEquals(true, events[2].path("kind").isMissingNode)
    }

    @Test
    fun `a series reads its period, player and dimension filters`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        val reply = get("series?event=core:menu_open&from=0&to=2026-11-16T00:00:00Z&by=day&player=$alice&dim.menu=shop", cookie)
        assertEquals(200, reply.statusCode())
        assertEquals(
            7 to SeriesQuery("core:menu_open", 0, 1794787200, Granularity.DAY, alice.toString(), mapOf("menu" to "shop"), ZoneId.of("UTC")),
            asked.single(),
        )
        val point = json(reply).path("points")[0]
        assertEquals(3600, point.path("start").asLong())
        assertEquals("hour", point.path("granularity").asText())
        assertEquals(4, point.path("count").asLong())
        assertEquals(6.0, point.path("sum").asDouble())
        for (bad in listOf("series?event=core:menu_open&from=0", "series?from=0&to=5", "series?event=x&from=5&to=1", "series?event=x&from=0&to=5&by=week", "series?event=x&from=0&to=5&player=Iban")) {
            assertEquals(422, get(bad, cookie).statusCode(), bad)
        }
    }

    @Test
    fun `a breakdown names its dimension, raw events page with a cursor`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        val breakdown = json(get("breakdown?event=core:menu_open&from=0&to=10&dim=menu", cookie))
        assertEquals("shop", breakdown.path("rows")[0].path("value").asText())
        assertEquals(7 to BreakdownQuery("core:menu_open", 0, 10, "menu"), asked.single())
        assertEquals(422, get("breakdown?event=core:menu_open&from=0&to=10", cookie).statusCode())
        asked.clear()
        val page = json(get("events?event=core:session&from=0&to=10&cursor=20&limit=1", cookie))
        assertEquals(7 to EventsQuery("core:session", 0, 10_000, null, 20, 1), asked.single())
        assertEquals(8, page.path("next").asLong())
        val row = page.path("events")[0]
        assertEquals(alice.toString(), row.path("player").asText())
        assertEquals("1", row.path("details").path("started_at").asText())
        assertEquals("b", row.path("dimensions").path("a").asText())
    }

    @Test
    fun `off, without a database or for an unknown server, the routes say so`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        enabled = false
        assertEquals("stats_disabled", json(get("catalog", cookie)).path("error").asText())
        enabled = true
        store = null
        assertEquals(503, get("catalog", cookie).statusCode())
    }

    @Test
    fun `actives give the distinct players of an event, over the period and per point`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        val reply = json(get("actives?event=core:session&from=0&to=86400&by=day&dim.menu=shop", cookie))
        assertEquals(7 to SeriesQuery("core:session", 0, 86400, Granularity.DAY, null, mapOf("menu" to "shop"), ZoneId.of("UTC")), asked.single())
        assertEquals(3, reply.path("players").asInt())
        assertEquals(2, reply.path("points")[0].path("players").asInt())
        assertEquals(422, get("actives?event=core:session&from=0", cookie).statusCode())
    }

    @Test
    fun `players are found by the start of their name or by id`() {
        hub.start()
        val cookie = login(setOf(EditorPermissions.STATS))
        assertEquals("Alice", json(get("players?q=al", cookie)).path("players")[0].path("name").asText())
        assertEquals(0, json(get("players?q=bo", cookie)).path("players").size())
        assertEquals(alice.toString(), json(get("players?ids=$alice,${UUID.randomUUID()}", cookie)).path("players").single().path("id").asText())
        assertEquals(422, get("players?ids=Iban", cookie).statusCode())
        assertEquals(403, get("players?q=al", login(setOf(EditorPermissions.VIEW))).statusCode())
    }

    @Test
    fun `a computed figure is asked to the running server, with its parameters`() {
        val sent = mutableListOf<Map<String, Any?>>()
        val live = object : EditorServer {
            override val id = "hub-1"
            override val online = true
            override val link = net.artisanmc.plugin.protocol.ServerLink { message ->
                sent += message
                java.util.concurrent.CompletableFuture.completedFuture(
                    if (message["id"] == "quests:stuck") mapOf("ok" to true, "rows" to listOf(mapOf("stage" to "s1", "players" to 3)), "computed_at" to 42L)
                    else mapOf("ok" to false, "error" to "unknown_query"),
                )
            }
            override val label = "survie"
            override val minecraftVersion = "1.21.7"
            override val pluginVersion = "2.0.0"
            override fun announcement() = net.artisanmc.plugin.protocol.ServerAnnouncement.EMPTY
            override fun serverConfig() = null
            override fun customItems() = emptyList<Map<String, String>>()
            override fun applyResourcePack(hash: String, path: String) {}
        }
        val liveRouter = Router().also { StatsRoutes(Servers(live), access).register(it) }
        val liveHub = HubServer(WebConfig(port = 0, bind = "127.0.0.1"), liveRouter, sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger())
        liveHub.start()
        try {
            val token = (sessions.issueLink(UUID.randomUUID(), "Iban", setOf(EditorPermissions.STATS), "hub-1") as Sessions.LinkResult.Issued).token
            val base = "http://127.0.0.1:${liveHub.port}"
            val cookie = client.send(HttpRequest.newBuilder(URI("$base/login/$token")).GET().build(), HttpResponse.BodyHandlers.ofString())
                .headers().firstValue("Set-Cookie").get().substringBefore(';')
            fun ask(query: String) = client.send(
                HttpRequest.newBuilder(URI("$base/api/v1/servers/hub-1/stats/query?$query")).header("Cookie", cookie).GET().build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            val reply = ask("id=quests:stuck&p.group=daily")
            assertEquals(200, reply.statusCode())
            assertEquals(3, json(reply).path("rows")[0].path("players").asInt())
            assertEquals(42, json(reply).path("computed_at").asLong())
            assertEquals(mapOf("type" to "stats_query_fetch", "id" to "quests:stuck", "params" to mapOf("group" to "daily")), sent.single())
            assertEquals(404, ask("id=quests:none").statusCode())
            assertEquals(422, ask("id=Stuck").statusCode())
        } finally {
            liveHub.stop()
        }
    }
}
