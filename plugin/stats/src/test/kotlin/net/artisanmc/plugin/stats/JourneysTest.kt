package net.artisanmc.plugin.stats

import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class JourneysTest {
    private val utc = ZoneId.of("UTC")
    private val day = 86_400L
    // Monday 2026-01-05 00:00 UTC.
    private val monday = 1_767_571_200L
    private val hits = mutableListOf<RawHit>()

    private fun hit(player: String, event: String, at: Long, dims: Map<String, String> = emptyMap(), details: String = "{}") {
        hits += RawHit(player, event, at * 1000, dims, details)
    }

    private fun join(player: String, at: Long) = hit(player, Journeys.FIRST_JOIN, at)

    private fun session(player: String, start: Long, end: Long) =
        hit(player, Journeys.SESSION, end, details = """{"started_at":"${start * 1000}"}""")

    private val scan = Journeys.Scan { from, to, events, each ->
        hits.filter { it.at >= from && it.at < to && (events == null || it.event in events) }.sortedBy { it.at }.forEach(each)
    }

    private fun compute(goals: List<JourneyGoal>, from: Long = monday, to: Long = monday + 14 * day, window: Int = 7, now: Long = monday + 60 * day) =
        Journeys.compute(scan, JourneyQuery(from, to, window, goals, utc, now))

    @Test
    fun `goals are reached in order, within the window of the arrival`() {
        val quest = JourneyGoal("First quest", "quests:completed", mapOf("quest" to "intro"))
        val buy = JourneyGoal("First purchase", "shop:buy")
        join("a", monday + 100); join("b", monday + 200); join("c", monday + 300); join("d", monday + 400)
        join("old", monday - day)
        // a: both, in order.
        hit("a", "quests:completed", monday + 700, mapOf("quest" to "intro", "group" to "story"))
        hit("a", "shop:buy", monday + 1300)
        // b: bought before finishing the quest: the purchase does not count as the second step.
        hit("b", "shop:buy", monday + 300)
        hit("b", "quests:completed", monday + 400, mapOf("quest" to "intro"))
        // c: another quest, then the right one after the window.
        hit("c", "quests:completed", monday + 500, mapOf("quest" to "other"))
        hit("c", "quests:completed", monday + 300 + 8 * day, mapOf("quest" to "intro"))
        // old did everything but arrived before the period.
        hit("old", "quests:completed", monday + 10, mapOf("quest" to "intro"))

        val result = compute(listOf(quest, buy))

        assertEquals(4, result.arrivals)
        assertEquals(listOf(JourneyStep("First quest", 2, 400.0), JourneyStep("First purchase", 1, 1200.0)), result.steps)
    }

    @Test
    fun `retention counts the arrivals old enough who had a session on that day`() {
        join("a", monday); join("b", monday); join("c", monday); join("late", monday + 13 * day)
        session("a", monday + day + 100, monday + day + 900)          // day 1
        session("a", monday + 7 * day + 5, monday + 7 * day + 50)      // day 7
        session("b", monday + 100, monday + 200)                      // day 0 only
        session("c", monday + day - 600, monday + day + 600)          // spans midnight of day 1: counts
        session("late", monday + 14 * day + 10, monday + 14 * day + 20)

        // 20 days after the first Monday: day 30 cannot be told for anyone, day 7 not for "late" (arrived 7 days ago).
        val result = compute(emptyList(), now = monday + 20 * day)

        assertEquals(listOf(RetentionPoint(1, 4, 3), RetentionPoint(7, 3, 1), RetentionPoint(30, 0, 0)), result.retention)
        assertEquals(emptyList(), result.steps)
    }

    @Test
    fun `cohorts group the arrivals by week`() {
        val goal = JourneyGoal("Menu", "core:menu_open")
        join("a", monday + 3 * day); join("b", monday + 6 * day); join("c", monday + 7 * day)
        hit("a", "core:menu_open", monday + 3 * day + 60)
        hit("c", "core:menu_open", monday + 7 * day + 60)
        session("c", monday + 8 * day + 60, monday + 8 * day + 120)

        val cohorts = compute(listOf(goal)).cohorts

        assertEquals(listOf(monday, monday + 7 * day), cohorts.map { it.weekStart })
        assertEquals(listOf(2, 1), cohorts.map { it.arrivals })
        assertEquals(listOf(listOf(1), listOf(1)), cohorts.map { it.reached })
        assertEquals(RetentionPoint(1, 1, 1), cohorts[1].retention[0])
        assertEquals(RetentionPoint(1, 2, 0), cohorts[0].retention[0])
        // Sunday night in Paris is already Monday in Tokyo.
        assertEquals(monday - 9 * 3600, Journeys.weekStart((monday - 3600) * 1000, ZoneId.of("Asia/Tokyo")))
    }

    @Test
    fun `the last action of those who left is what they did before their last session ended`() {
        join("a", monday); join("b", monday); join("c", monday); join("stays", monday)
        hit("a", "core:menu_open", monday + 50, mapOf("menu" to "jobs:main"))
        session("a", monday, monday + 60)
        hit("b", "core:command", monday + 20, mapOf("command" to "spawn"))
        hit("b", "core:menu_open", monday + 70, mapOf("menu" to "jobs:main"))
        session("b", monday, monday + 80)
        // c left without doing anything recorded.
        session("c", monday, monday + 30)
        hit("stays", "core:command", monday + 59 * day, mapOf("command" to "shop"))

        val result = compute(emptyList())

        assertEquals(3, result.leavers)
        assertEquals(listOf(LastAction("core:menu_open", mapOf("menu" to "jobs:main"), 2)), result.lastActions)
    }

    @Test
    fun `nobody arrived, nothing is read twice`() {
        val result = compute(listOf(JourneyGoal("x", "a:b")))
        assertEquals(0, result.arrivals)
        assertEquals(listOf(JourneyStep("x", 0, null)), result.steps)
        assertEquals(emptyList(), result.cohorts)
        assertNull(Journeys.median(emptyList()))
        assertEquals(1_700_000_000_000, Journeys.startedAt("""{"started_at":"1700000000000"}"""))
        assertNull(Journeys.startedAt("{}"))
    }
}
