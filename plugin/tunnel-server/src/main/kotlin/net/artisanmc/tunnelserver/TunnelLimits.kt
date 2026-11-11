package net.artisanmc.tunnelserver

import java.time.Clock
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * What one tunnel may use, kept in memory: a restart forgets it, which is fine for a cap that
 * only has to make abuse expensive. Browser requests per minute and bytes per day are refused
 * past their limit (429); bandwidth is slowed, never refused.
 */
class TunnelLimits(
    private val requestsPerMinute: Int,
    private val bytesPerSecond: Long,
    private val bytesPerDay: Long,
    private val clock: Clock = Clock.systemUTC(),
) {
    private var minute = 0L
    private var requests = 0
    private var day: LocalDate = LocalDate.MIN
    private var usedToday = 0L
    private var tokens = bytesPerSecond.toDouble()
    private var refilledAt = clock.millis()

    /** False past [requestsPerMinute] in the current minute, or once today's volume is spent. */
    @Synchronized
    fun allowRequest(): Boolean {
        val now = clock.millis() / 60_000
        if (now != minute) {
            minute = now
            requests = 0
        }
        if (overQuota()) return false
        if (requestsPerMinute > 0 && requests >= requestsPerMinute) return false
        requests++
        return true
    }

    @Synchronized
    fun overQuota(): Boolean {
        rollDay()
        return bytesPerDay > 0 && usedToday >= bytesPerDay
    }

    /** Counts [bytes] against the day and waits until the bandwidth allows them. */
    fun consume(bytes: Int) {
        val wait = synchronized(this) {
            rollDay()
            usedToday += bytes
            if (bytesPerSecond <= 0) return
            val now = clock.millis()
            tokens = minOf(bytesPerSecond.toDouble(), tokens + (now - refilledAt) * bytesPerSecond / 1000.0)
            refilledAt = now
            tokens -= bytes
            if (tokens >= 0) 0L else (-tokens * 1000 / bytesPerSecond).toLong()
        }
        if (wait > 0) Thread.sleep(wait)
    }

    private fun rollDay() {
        val today = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC)
        if (today != day) {
            day = today
            usedToday = 0
        }
    }
}
