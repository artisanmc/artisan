package net.artisanmc.plugin.expr

/**
 * Number shortening for `compact()` — mirror of `editor/src/lib/expr/compact.ts`,
 * pinned by the conformance vector.
 *
 * As is below 10,000, then one unit of K, M, B or T: `18.4K`, `184K`, `1.8M`, `12T`, at most five
 * characters up to 999T. Always rounded toward zero, so a balance never reads higher than it is
 * (999,999 is `999K`, not `1000K`); one decimal below 100 of a unit, never `.0`. Integer
 * arithmetic only, so both implementations agree digit for digit.
 */
object Compact {
    private val UNITS = listOf("K", "M", "B", "T")

    fun format(value: Double): String {
        val whole = if (value.isFinite()) value.toLong() else return ""
        val abs = Math.abs(whole)
        val sign = if (whole < 0) "-" else ""
        if (abs < 10_000) return sign + abs
        var unit = 0
        var divisor = 1_000L
        while (unit < UNITS.size - 1 && abs / divisor >= 1_000) {
            divisor *= 1_000
            unit++
        }
        val units = abs / divisor
        if (units >= 100) return sign + units + UNITS[unit]
        val tenth = abs % divisor / (divisor / 10)
        return sign + units + (if (tenth == 0L) "" else ".$tenth") + UNITS[unit]
    }
}
