package net.artisanmc.plugin.stats

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class StatQueriesTest {
    private var now = 1_000_000L
    private val recorder = StatsRecorder(clock = { now }, warn = {})
    private var calls = 0

    private fun declare(cacheSeconds: Int = 60) = recorder.declareQuery("quests:stuck", cacheSeconds) { params ->
        calls++
        listOf(mapOf("group" to params["group"], "players" to calls))
    }

    @Test
    fun `an answer is served again while it is fresh, per set of parameters`() {
        declare()
        assertEquals(listOf(mapOf("group" to "daily", "players" to 1)), recorder.queries.run("quests:stuck", mapOf("group" to "daily"))?.rows)
        now += 59_000
        assertEquals(1_000_000L, recorder.queries.run("quests:stuck", mapOf("group" to "daily"))?.computedAt)
        assertEquals(2, recorder.queries.run("quests:stuck", mapOf("group" to "weekly"))?.rows?.single()?.get("players"))
        now += 2_000
        assertEquals(3, recorder.queries.run("quests:stuck", mapOf("group" to "daily"))?.rows?.single()?.get("players"))
    }

    @Test
    fun `a query without cache is computed each time, and declaring again forgets the old answers`() {
        declare(cacheSeconds = 0)
        recorder.queries.run("quests:stuck", emptyMap())
        recorder.queries.run("quests:stuck", emptyMap())
        assertEquals(2, calls)
        declare()
        recorder.queries.run("quests:stuck", emptyMap())
        declare()
        recorder.queries.run("quests:stuck", emptyMap())
        assertEquals(4, calls)
    }

    @Test
    fun `an undeclared query has no answer, a wrong declaration is refused`() {
        assertNull(recorder.queries.run("quests:none", emptyMap()))
        assertFailsWith<IllegalArgumentException> { recorder.declareQuery("Stuck", 60) { emptyList() } }
        assertFailsWith<IllegalArgumentException> { recorder.declareQuery("core:stuck", 60) { emptyList() } }
        assertFailsWith<IllegalArgumentException> { recorder.declareQuery("quests:stuck", 7200) { emptyList() } }
    }

    @Test
    fun `what the module throws reaches the caller and is not cached`() {
        var fail = true
        recorder.declareQuery("quests:flaky", 60) { if (fail) error("database down") else listOf(mapOf("ok" to true)) }
        assertFailsWith<IllegalStateException> { recorder.queries.run("quests:flaky", emptyMap()) }
        fail = false
        assertEquals(listOf(mapOf("ok" to true)), recorder.queries.run("quests:flaky", emptyMap())?.rows)
    }
}
