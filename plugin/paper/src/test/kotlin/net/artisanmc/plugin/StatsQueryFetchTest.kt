package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.scheduling.Scheduler
import net.artisanmc.plugin.stats.StatsRecorder
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A module's figure computed on demand, asked by its statistics tab (`stats_query_fetch`). */
class StatsQueryFetchTest {
    private val mapper = ObjectMapper()
    private val recorder = StatsRecorder(warn = {})

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private fun ask(message: String, wired: Boolean = true): Map<String, Any?> {
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(Files.createTempDirectory("artisan_statq_").toFile()), logger = null,
            scheduler = Scheduler.Direct,
            statQuery = if (wired) recorder.queries::run else null,
        )
        p.load()
        p.setSendForTesting { raw ->
            @Suppress("UNCHECKED_CAST")
            sink.add(mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            latch.countDown()
        }
        p.handleMessageForTesting(message)
        assertTrue(latch.await(5, TimeUnit.SECONDS), "no stats_query_result sent within 5s")
        return sink[0]
    }

    @Test
    fun `answers with the module's rows for the asked parameters`() {
        recorder.declareQuery("quests:stuck", 60) { params -> listOf(mapOf("group" to params["group"], "players" to 4)) }
        val reply = ask("""{"type":"stats_query_fetch","request_id":"r1","id":"quests:stuck","params":{"group":"daily"}}""")
        assertEquals("stats_query_result", reply["type"])
        assertEquals(true, reply["ok"])
        assertEquals(listOf(mapOf("group" to "daily", "players" to 4)), reply["rows"])
        assertTrue((reply["computed_at"] as Number).toLong() > 0)
    }

    @Test
    fun `an undeclared query, a failing one and statistics not wired each say so`() {
        recorder.declareQuery("quests:broken", 60) { error("database down") }
        assertEquals("unknown_query", ask("""{"type":"stats_query_fetch","request_id":"r1","id":"quests:none"}""")["error"])
        assertEquals("query_failed", ask("""{"type":"stats_query_fetch","request_id":"r1","id":"quests:broken"}""")["error"])
        assertEquals("stats_disabled", ask("""{"type":"stats_query_fetch","request_id":"r1","id":"quests:stuck"}""", wired = false)["error"])
    }
}
