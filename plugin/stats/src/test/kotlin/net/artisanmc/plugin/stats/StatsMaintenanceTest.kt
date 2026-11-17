package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.modules.api.stats.StatStorage
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class StatsMaintenanceTest {
    private class FakeWriter(var fail: Boolean = false) : StatsWriter {
        val written = mutableListOf<StatsBatch>()
        val calls = mutableListOf<String>()
        override fun write(batch: StatsBatch) {
            if (fail) throw IllegalStateException("database down")
            written += batch
        }
        override fun rollup(before: Long, zone: ZoneId): Int { calls += "rollup $before $zone"; return 1 }
        override fun purgeDays(before: Long): Int { calls += "days $before"; return 0 }
        override fun purgeRaw(before: Long, perEvent: Map<String, Long>): Int { calls += "raw $before $perEvent"; return 0 }
    }

    private val now = ZonedDateTime.parse("2026-11-16T15:30+01:00[Europe/Paris]")
    private val stats = StatsRecorder(clock = { now.toInstant().toEpochMilli() }, warn = {})

    @Test
    fun `a flush writes the buffer, and a failed one keeps it for the next`() {
        stats.declare(StatEvent.builder("test:hit").storage(StatStorage.BOTH).build())
        stats.record("test:hit", UUID.randomUUID(), mapOf())
        val writer = FakeWriter(fail = true)
        assertFailsWith<IllegalStateException> { stats.flushTo(writer) }
        writer.fail = false
        assertEquals(2, stats.flushTo(writer))
        assertEquals(1, writer.written.size)
        assertEquals(0, stats.flushTo(writer))
        assertEquals(1, writer.written.size)
    }

    @Test
    fun `maintenance merges whole days past the hourly retention and purges by age`() {
        stats.declare(StatEvent.builder("test:short").storage(StatStorage.RAW).rawRetentionDays(7).build())
        val writer = FakeWriter()
        val zone = ZoneId.of("Europe/Paris")
        StatsMaintenance.run(writer, now.toInstant().toEpochMilli(), StatsRetention(hourlyDays = 90, dailyDays = 0, rawDays = 90), zone, stats.rawRetentions())
        val midnight90 = ZonedDateTime.parse("2026-08-18T00:00+02:00[Europe/Paris]").toEpochSecond()
        val ms = now.toInstant().toEpochMilli()
        assertEquals(
            listOf("rollup $midnight90 Europe/Paris", "raw ${ms - 90 * DAY} {test:short=${ms - 7 * DAY}}"),
            writer.calls,
        )
        writer.calls.clear()
        StatsMaintenance.run(writer, ms, StatsRetention(hourlyDays = 30, dailyDays = 400, rawDays = 30), zone, emptyMap())
        assertTrue(writer.calls[1].startsWith("days "), writer.calls.toString())
    }

    private companion object {
        const val DAY = 86_400_000L
    }
}
