package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.MetricUnit
import net.artisanmc.modules.api.stats.PlayerMetric
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class MetricsTest {
    private val warnings = mutableListOf<String>()
    private var enabled = true
    private val stats = StatsRecorder(warn = { warnings += it }, settings = { StatsSettings(enabled = enabled) })
    private val alice = UUID.fromString("00000000-0000-0000-0000-00000000000a")
    private val streak = PlayerMetric.builder("daily:streak").label("en", "Login streak").unit(MetricUnit.DAYS).build()

    @Test
    fun `the latest value per metric and player is kept until written`() {
        stats.declareMetric(streak)
        stats.setMetric("daily:streak", alice, 1)
        stats.setMetric("daily:streak", alice, 2)
        val written = mutableListOf<MetricValue>()
        assertEquals(1, stats.flushMetricsTo({ values, _ -> written += values }, now = 10))
        assertEquals(listOf(MetricValue("daily:streak", alice.toString(), 2)), written)
        assertEquals(0, stats.flushMetricsTo({ _, _ -> error("nothing to write") }))
    }

    @Test
    fun `a failed write keeps the values behind newer ones`() {
        stats.declareMetric(streak)
        stats.setMetric("daily:streak", alice, 5)
        assertFailsWith<IllegalStateException> { stats.flushMetricsTo({ _, _ -> stats.setMetric("daily:streak", alice, 6); error("down") }) }
        assertEquals(listOf(MetricValue("daily:streak", alice.toString(), 6)), stats.metricBuffer.drain())
    }

    @Test
    fun `an undeclared metric is dropped with one warning, nothing is kept while statistics are off`() {
        stats.setMetric("daily:streak", alice, 1)
        stats.setMetric("daily:streak", alice, 2)
        assertEquals(1, warnings.size)
        stats.declareMetric(streak)
        enabled = false
        stats.setMetric("daily:streak", alice, 3)
        assertEquals(0, stats.metricBuffer.size())
    }

    @Test
    fun `Artisan's namespaces and a second shape are refused, the same declaration twice is not`() {
        assertFailsWith<IllegalArgumentException> { stats.declareMetric(PlayerMetric.builder("core:money").label("en", "Money").build()) }
        stats.declareMetric(streak)
        stats.declareMetric(PlayerMetric.builder("daily:streak").label("en", "Login streak").unit(MetricUnit.DAYS).build())
        assertFailsWith<IllegalArgumentException> { stats.declareMetric(PlayerMetric.builder("daily:streak").label("en", "Streak").build()) }
        stats.declareCoreMetric(PlayerMetric.builder("core:money").label("en", "Money").build())
        assertEquals(listOf("core:money", "daily:streak"), stats.declaredMetrics().map { it.id })
    }

    @Test
    fun `forgetting a player drops their buffered values`() {
        stats.declareMetric(streak)
        stats.setMetric("daily:streak", alice, 1)
        stats.metricBuffer.forget(alice.toString())
        assertTrue(stats.metricBuffer.drain().isEmpty())
    }
}
