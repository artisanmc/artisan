package net.artisanmc.modules.api

import net.artisanmc.modules.api.stats.MetricUnit
import net.artisanmc.modules.api.stats.PlayerMetric
import net.artisanmc.modules.api.stats.StatsApi
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlayerMetricTest {
    @Test
    fun `a metric defaults to a ranked count, highest first`() {
        val metric = PlayerMetric.builder("daily:streak").label("en", "Login streak").build()
        assertEquals("daily", metric.namespace)
        assertEquals(MetricUnit.COUNT, metric.unit)
        assertTrue(metric.isRanked)
        assertFalse(metric.isAscending)
        assertEquals(mapOf("en" to "Login streak"), metric.labels)
    }

    @Test
    fun `every part is kept and two equal declarations are equal`() {
        fun build() = PlayerMetric.builder("races:best_time").label("en", " Best time ").label("fr", "Meilleur temps")
            .unit(MetricUnit.SECONDS).ranked(true).ascending().build()
        assertEquals(build(), build())
        assertEquals(mapOf("en" to "Best time", "fr" to "Meilleur temps"), build().labels)
        assertTrue(build().isAscending)
        assertFalse(build() == PlayerMetric.builder("races:best_time").label("en", "Best time").build())
    }

    @Test
    fun `a malformed id, locale or label, or no label, is refused`() {
        assertFailsWith<IllegalArgumentException> { PlayerMetric.builder("Streak") }
        assertFailsWith<IllegalArgumentException> { PlayerMetric.builder("daily:streak").label("english", "Streak") }
        assertFailsWith<IllegalArgumentException> { PlayerMetric.builder("daily:streak").label("en", "  ") }
        assertFailsWith<IllegalArgumentException> { PlayerMetric.builder("daily:streak").label("en", "x".repeat(65)) }
        assertFailsWith<IllegalStateException> { PlayerMetric.builder("daily:streak").build() }
    }

    @Test
    fun `NOOP accepts metrics and drops their values`() {
        StatsApi.NOOP.declareMetric(PlayerMetric.builder("daily:streak").label("en", "Streak").build())
        StatsApi.NOOP.setMetric("daily:streak", UUID.randomUUID(), 3)
    }

    @Test
    fun `a metric is a state unless declared cumulative`() {
        val streak = PlayerMetric.builder("daily:streak").label("en", "Streak")
        assertEquals(false, streak.build().isCumulative)
        assertEquals(true, PlayerMetric.builder("quests:completed").label("en", "Quests").cumulative().build().isCumulative)
    }
}
