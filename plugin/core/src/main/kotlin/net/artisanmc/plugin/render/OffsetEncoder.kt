package net.artisanmc.plugin.render

/**
 * Encodes pixel offsets into a string of "space-font" characters compatible
 * with the `space` provider in the `artisan:default` font.
 *
 * The codepoint → advance mapping is loaded from the resource pack's
 * `asset-index.json` (`offsets` field, schema version 2). The editor writes
 * powers of two in both signs (±1, ±2, ..., ±256), so a greedy decomposition
 * by descending magnitude reaches any offset in `[-511, +511]` exactly.
 *
 * Out-of-range inputs (or an empty offset table, e.g. when the catalog hasn't
 * loaded yet) return a best-effort string instead of throwing. This keeps the
 * title pipeline non-fatal: a missing offset just means slightly wrong layout,
 * not a crash mid-render. The companion's [from] factory is the one place
 * that mediates between raw map data and the encoder.
 *
 * @property entries (char, advance) pairs sorted by descending |advance|.
 *                  Sorting is done once at construction so [encode] is just
 *                  a linear scan.
 */
class OffsetEncoder(entries: List<Pair<Char, Int>>) {
    private val sorted: List<Pair<Char, Int>> = entries.sortedByDescending { kotlin.math.abs(it.second) }

    /** Maximum total positive shift the encoder can produce. */
    val maxPositive: Int = sorted.filter { it.second > 0 }.sumOf { it.second }
    /** Maximum total negative shift the encoder can produce (i.e. most negative). */
    val maxNegative: Int = sorted.filter { it.second < 0 }.sumOf { it.second }

    /**
     * Returns the (char → advance) map of every entry this encoder can emit.
     * Used by diagnostic commands (e.g. /artisan dump-title) to decode an
     * assembled string back into pixel sums, mirroring what MC's space
     * provider does at render time.
     */
    fun advances(): Map<Char, Int> = sorted.toMap()

    /**
     * Returns a sequence of "space" chars whose advances sum to [pixels].
     * Empty string for `0`. For out-of-range inputs, emits as many same-sign
     * advances as possible and stops (best-effort — caller may compare
     * `decode(out) == pixels` if exactness is required).
     */
    fun encode(pixels: Int): String {
        if (pixels == 0 || sorted.isEmpty()) return ""
        val sb = StringBuilder()
        var remaining = pixels
        for ((ch, adv) in sorted) {
            // Skip entries with the wrong sign (we never overshoot toward 0).
            if (remaining > 0 && adv <= 0) continue
            if (remaining < 0 && adv >= 0) continue
            while (
                (adv > 0 && remaining >= adv) ||
                (adv < 0 && remaining <= adv)
            ) {
                sb.append(ch)
                remaining -= adv
            }
            if (remaining == 0) break
        }
        return sb.toString()
    }

    companion object {
        /**
         * Builds an [OffsetEncoder] from a `codepoint → advance` map (as parsed
         * from `asset-index.json#offsets`).
         */
        fun from(map: Map<Int, Int>): OffsetEncoder =
            OffsetEncoder(map.entries.map { (cp, adv) -> cp.toChar() to adv })

        /** An encoder with no offsets; [encode] always returns `""`. */
        val EMPTY: OffsetEncoder = OffsetEncoder(emptyList())
    }
}
