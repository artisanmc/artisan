package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.MetricUnit
import net.artisanmc.modules.api.stats.PlayerMetric
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StatsExportTest {
    /** Rows as the database holds them, filtered and paged like `MetricRows`. */
    private class Table : ExportSource {
        val values = mutableListOf<ExportedValue>()
        val players = mutableListOf<ExportedPlayer>()

        override fun values(since: Long, until: Long, after: ExportedValue?, limit: Int) =
            values.filter { it.at in (since + 1)..until }
                .sortedWith(compareBy({ it.at }, { it.metric }, { it.player }))
                .dropWhile { a -> after != null && compareValuesBy(a, after, { it.at }, { it.metric }, { it.player }) <= 0 }
                .take(limit)

        override fun players(since: Long, until: Long, after: ExportedPlayer?, limit: Int) =
            players.filter { it.lastSeen in (since + 1)..until }
                .sortedWith(compareBy({ it.lastSeen }, { it.player }))
                .dropWhile { a -> after != null && compareValuesBy(a, after, { it.lastSeen }, { it.player }) <= 0 }
                .take(limit)

        val times = mutableListOf<ExportedServerTime>()
        val servers = mutableMapOf<Int, String>()

        override fun serverTimes(since: Long, until: Long, after: ExportedServerTime?, limit: Int) =
            times.filter { it.lastSeen in (since + 1)..until }
                .sortedWith(compareBy({ it.lastSeen }, { it.server }, { it.player }))
                .dropWhile { a -> after != null && compareValuesBy(a, after, { it.lastSeen }, { it.server }, { it.player }) <= 0 }
                .take(limit)

        override fun servers() = servers
    }

    /** A website that keeps its cursor and every payload it got. */
    private class Site {
        var cursor = 0L
        val payloads = mutableListOf<String>()
        var down = false

        fun post(json: String): String {
            if (down) throw java.io.IOException("connection refused")
            payloads += json
            val since = Regex("\"since\":(\\d+)").find(json)?.groupValues?.get(1)?.toLong()
            if (since != null && cursor < since) return """{"cursor":$cursor}"""
            Regex("\"cursor\":(\\d+)").find(json)?.let { cursor = it.groupValues[1].toLong() }
            return """{"cursor":$cursor}"""
        }
    }

    private var now = 10_000_000L
    private val table = Table()
    private val site = Site()
    private val streak = PlayerMetric.builder("daily:streak").label("fr", "Série").label("en", "Streak").unit(MetricUnit.DAYS).build()
    private fun export(pageSize: Int = 2000) = StatsExport(table, site::post, { listOf(streak) }, "lobby", clock = { now }, pageSize = pageSize)

    @Test
    fun `the first run asks the cursor, then sends everything with the metrics and the new cursor`() {
        table.players += ExportedPlayer("a", "Alice", 1_000, 5_000_000, 7_200_000)
        table.values += ExportedValue("daily:streak", "a", 3, 6_000_000)
        val run = export().run()
        assertEquals(2, site.payloads.size)
        assertTrue(site.payloads[0].contains("\"cursor\":null"))
        assertTrue(site.payloads[0].contains("\"players\":[]"))
        assertEquals(
            """{"protocol":1,"server":"lobby","since":0,"cursor":9999000,"metrics":[{"id":"daily:streak","unit":"days","ranked":true,"ascending":false,"labels":{"en":"Streak","fr":"Série"}}],""" +
                """"players":[{"uuid":"a","name":"Alice","first_seen":1,"last_seen":5000}],""" +
                """"values":[{"metric":"core:playtime","uuid":"a","value":7200},{"metric":"daily:streak","uuid":"a","value":3}],"forget":[]}""",
            site.payloads[1],
        )
        assertEquals(ExportRun(1, 1, 1, 0, 9_999_000), run)
    }

    @Test
    fun `a later run sends only what changed since the cursor, with an overlap for clocks`() {
        val export = export()
        table.values += ExportedValue("daily:streak", "old", 1, 1_000_000)
        export.run()
        table.values += ExportedValue("daily:streak", "skewed", 2, 9_950_000)
        table.values += ExportedValue("daily:streak", "new", 3, 10_500_000)
        now = 11_000_000
        val run = export.run()
        val last = site.payloads.last()
        assertFalse(last.contains("\"old\""))
        assertTrue(last.contains("\"skewed\"") && last.contains("\"new\""))
        assertEquals(10_999_000, run.cursor)
    }

    @Test
    fun `rows sharing one instant are paged without a loss and the cursor comes with the last page`() {
        repeat(5) { table.values += ExportedValue("daily:streak", "p$it", it.toLong(), 2_000_000) }
        repeat(3) { table.players += ExportedPlayer("q$it", "Q$it", 0, 3_000_000, 0) }
        val run = export(pageSize = 2).run()
        val sent = site.payloads.drop(1)
        // 3 players and 5 values in pages of 2; the last page, empty, brings the cursor.
        assertEquals(5, sent.size)
        assertEquals(5, run.pages)
        assertTrue(sent.dropLast(1).all { it.contains("\"cursor\":null") })
        assertTrue(sent.last().contains("\"cursor\":9999000"))
        repeat(5) { i -> assertEquals(1, sent.count { it.contains("\"uuid\":\"p$i\"") }) }
        assertEquals(5, run.values)
        assertEquals(3, run.players)
    }

    @Test
    fun `a website that lost its data gets everything again on the next run`() {
        val export = export()
        table.values += ExportedValue("daily:streak", "a", 3, 1_000_000)
        export.run()
        site.cursor = 0
        table.values += ExportedValue("daily:streak", "b", 4, 10_500_000)
        now = 11_000_000
        assertTrue(export.run().resync)
        assertEquals(0, export.cursor)
        export.run()
        assertTrue(site.payloads.last().contains("\"uuid\":\"a\""))
    }

    @Test
    fun `a forgotten player travels in forget, and an older row of theirs in the same page is left out`() {
        table.players += ExportedPlayer("a", "Alice", 0, 1_000_000, 60_000)
        table.values += ExportedValue(StatsExport.FORGOTTEN, "a", 0, 2_000_000)
        val run = export().run()
        val last = site.payloads.last()
        assertTrue(last.contains("\"forget\":[\"a\"]"))
        assertFalse(last.contains("Alice"))
        assertFalse(last.contains(StatsExport.FORGOTTEN))
        assertEquals(1, run.forgotten)
    }

    @Test
    fun `a website down keeps the cursor for the next run`() {
        val export = export()
        export.run()
        site.down = true
        assertFailsWith<java.io.IOException> { export.run() }
        assertEquals(9_999_000, export.cursor)
    }

    @Test
    fun `an answer without a cursor is a refusal`() {
        assertFailsWith<IllegalStateException> { StatsExport.parseCursor("<html>login</html>") }
        assertEquals(42, StatsExport.parseCursor("""{ "cursor" : 42 }"""))
        assertNull(StatsExport(table, { """{"cursor":0}""" }, { emptyList() }, "x").cursor)
    }

    @Test
    fun `play time per server travels as one metric per server, a tab of the network total`() {
        table.servers += mapOf(3 to "survie")
        table.players += ExportedPlayer("a", "Alice", 1_000, 5_000_000, 7_200_000)
        table.times += ExportedServerTime(3, "a", 3_600_500, 5_000_000)
        export().run()
        val page = site.payloads[1]
        assertTrue(
            page.contains(
                """{"id":"core:playtime.s3","unit":"seconds","ranked":true,"ascending":false,"cumulative":true,"parent":"core:playtime","scope":"survie",""" +
                    """"labels":{"en":"Play time on survie","fr":"Temps de jeu sur survie"}}""",
            ),
            page,
        )
        assertTrue(page.contains("""{"metric":"core:playtime.s3","uuid":"a","value":3600}"""), page)
    }

    @Test
    fun `play time per server is paged after the values, and the cursor waits for its last page`() {
        repeat(3) { table.values += ExportedValue("daily:streak", "p$it", 1, 6_000_000) }
        repeat(4) { table.times += ExportedServerTime(1, "p$it", 1_000, 6_000_000L + it) }
        val run = export(pageSize = 2).run()
        val pages = site.payloads.drop(1)
        assertEquals(4, pages.size)
        assertEquals(listOf(true, true, true, false), pages.map { it.contains("\"cursor\":null") })
        assertEquals(7, run.values)
        (0 until 4).forEach { i -> assertTrue(pages.any { it.contains(""""metric":"core:playtime.s1","uuid":"p$i"""") }, "p$i") }
    }

    @Test
    fun `a cumulative metric says so, a state does not`() {
        val quests = PlayerMetric.builder("quests:completed").label("en", "Quests").cumulative().build()
        StatsExport(table, site::post, { listOf(streak, quests) }, "lobby", clock = { now }).run()
        assertTrue(site.payloads[0].contains(""""id":"quests:completed","unit":"count","ranked":true,"ascending":false,"cumulative":true,"""), site.payloads[0])
        assertTrue(site.payloads[0].contains(""""id":"daily:streak","unit":"days","ranked":true,"ascending":false,"labels""""), site.payloads[0])
    }
}
