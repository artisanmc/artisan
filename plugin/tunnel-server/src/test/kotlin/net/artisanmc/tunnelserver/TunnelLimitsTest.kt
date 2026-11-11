package net.artisanmc.tunnelserver

import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TunnelLimitsTest {
    private class MovableClock(var now: Instant) : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant() = now
    }

    private val clock = MovableClock(Instant.parse("2026-10-20T10:00:00Z"))

    @Test
    fun `requests per minute reset with the minute`() {
        val limits = TunnelLimits(requestsPerMinute = 2, bytesPerSecond = 0, bytesPerDay = 0, clock = clock)
        assertTrue(limits.allowRequest())
        assertTrue(limits.allowRequest())
        assertFalse(limits.allowRequest())
        clock.now = clock.now.plusSeconds(60)
        assertTrue(limits.allowRequest())
    }

    @Test
    fun `the daily volume refuses requests until the next UTC day`() {
        val limits = TunnelLimits(requestsPerMinute = 0, bytesPerSecond = 0, bytesPerDay = 1000, clock = clock)
        limits.consume(1000)
        assertFalse(limits.allowRequest())
        clock.now = Instant.parse("2026-10-21T00:00:01Z")
        assertTrue(limits.allowRequest())
    }
}
