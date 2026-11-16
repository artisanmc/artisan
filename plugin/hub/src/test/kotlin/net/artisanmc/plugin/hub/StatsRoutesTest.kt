package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.modules.api.stats.StatEvent
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
        override fun events(server: Int, q: EventsQuery): EventsPage {
            asked += server to q
            return EventsPage(listOf(EventRow(9, alice.toString(), "core:session", 1000, mapOf("a" to "b"), 12.5, """{"started_at":"1"}""")), 8)
        }
    }
    private var enabled = true
    private var store: StatsReader? = reader
    private val sessions = Sessions()
    private val servers = Servers(RemoteServer("hub-1", "survie", publicUrl = { "" }))
    private val access = StatsAccess(
        reader = { store },
        rowOf = { if (it == "hub-1") 7 else null },
        enabled = { enabled },
        declared = { listOf(StatEvent.builder("core:menu_open").dimensions("menu").build()) },
        zone = { ZoneId.of("UTC") },
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

    @Test
    fun `statistics need their own permission, which editing does not give`() {
        hub.start()
        val editor = login(setOf(EditorPermissions.VIEW, EditorPermissions.EDIT, EditorPermissions.PUBLISH, EditorPermissions.CONFIG))
        assertEquals(403, get("catalog", editor).statusCode())
        assertEquals(200, get("catalog", login(setOf(EditorPermissions.VIEW, EditorPermissions.STATS))).statusCode())
        assertEquals(true, EditorPermissions.STATS in EditorPermissions.ALL)
    }

    @Test
    fun `the catalog lists stored events with the shape their server declared`() {
        hub.start()
        val events = json(get("catalog", login(setOf(EditorPermissions.STATS)))).path("events")
        assertEquals(listOf("core:menu_open", "quests:old"), events.map { it.path("event").asText() })
        assertEquals(listOf("menu"), events[0].path("dimensions").map { it.asText() })
        assertEquals("counter", events[0].path("kind").asText())
        assertEquals(true, events[1].path("raw").asBoolean())
        assertEquals(true, events[1].path("kind").isMissingNode)
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
}
