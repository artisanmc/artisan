package net.artisanmc.plugin.stats

import java.time.ZoneId

/** `stats.retention` of `config.yml`, in days (ADR `stats-foundation` ⑥). */
data class StatsRetention(
    /** Hour buckets older than this are merged into days. */
    val hourlyDays: Int = 90,
    /** Day buckets older than this are deleted; 0 keeps them. */
    val dailyDays: Int = 0,
    /** Raw rows older than this are deleted, unless their event says otherwise. */
    val rawDays: Int = 90,
)

/** The daily pass: hours into days, then the purges. Off the main thread. */
object StatsMaintenance {
    private const val DAY_MS = 86_400_000L

    fun run(writer: StatsWriter, now: Long, retention: StatsRetention, zone: ZoneId, rawRetentions: Map<String, Int>) {
        val nowSeconds = now / 1000
        writer.rollup(Rollup.dayStart(nowSeconds - retention.hourlyDays * 86_400L, zone), zone)
        if (retention.dailyDays > 0) writer.purgeDays(Rollup.dayStart(nowSeconds - retention.dailyDays * 86_400L, zone))
        writer.purgeRaw(now - retention.rawDays * DAY_MS, rawRetentions.mapValues { (_, days) -> now - days * DAY_MS })
    }
}
