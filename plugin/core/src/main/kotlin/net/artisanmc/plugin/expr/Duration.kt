package net.artisanmc.plugin.expr

/**
 * Duration rendering for `until()` — mirror of `editor/src/lib/expr/duration.ts`,
 * pinned by the conformance vector.
 *
 * Units are project data (`artisan.duration.*` in the project's `lang/`), so they
 * follow the viewer's language. The defaults here are the fallback and MUST match
 * the TS ones byte for byte (ADR `expression-parity` §8).
 */
object Duration {
    const val KEY_DAYS = "artisan.duration.days"
    const val KEY_HOURS = "artisan.duration.hours"
    const val KEY_MINUTES = "artisan.duration.minutes"
    const val KEY_SECONDS = "artisan.duration.seconds"

    val DEFAULTS = mapOf(
        KEY_DAYS to "{n}d",
        KEY_HOURS to "{n}h",
        KEY_MINUTES to "{n}m",
        KEY_SECONDS to "{n}s",
    )

    private val LADDER = listOf(
        KEY_DAYS to 86_400_000L,
        KEY_HOURS to 3_600_000L,
        KEY_MINUTES to 60_000L,
        KEY_SECONDS to 1_000L,
    )

    /**
     * Shows the most significant non-zero unit plus the next one down when it is
     * also non-zero — `3h 12m`, `2d 5h`, `45s`. A past or zero delta reads `0s`:
     * a countdown that has run out should say so, not go negative or blank.
     */
    fun format(deltaMs: Long, translate: (String) -> String?): String {
        fun unit(key: String, n: Long): String =
            (translate(key) ?: DEFAULTS.getValue(key)).replace("{n}", n.toString())

        if (deltaMs <= 0) return unit(KEY_SECONDS, 0)

        var rest = deltaMs
        val values = LinkedHashMap<String, Long>()
        for ((key, ms) in LADDER) {
            val v = rest / ms
            values[key] = v
            rest -= v * ms
        }

        val firstIndex = LADDER.indexOfFirst { (key, _) -> values.getValue(key) > 0 }
        if (firstIndex == -1) return unit(KEY_SECONDS, 0)

        val headKey = LADDER[firstIndex].first
        val parts = mutableListOf(unit(headKey, values.getValue(headKey)))
        LADDER.getOrNull(firstIndex + 1)?.let { (nextKey, _) ->
            if (values.getValue(nextKey) > 0) parts += unit(nextKey, values.getValue(nextKey))
        }
        return parts.joinToString(" ")
    }
}
