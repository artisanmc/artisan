package net.artisanmc.plugin.stats

/** A bucket's span: an hour (UTC) or a day (in `stats.timezone`). Stored as [code]. */
enum class Granularity(val code: String) {
    HOUR("H"),
    DAY("D");

    companion object {
        fun of(code: String): Granularity = entries.first { it.code == code }
    }
}

/**
 * One row of `artisan_stats_buckets` without its server: [player] is a UUID, or `""` for a server
 * event; [start] in epoch seconds; [dims] as [Dimensions.encode] writes them.
 */
data class BucketRow(
    val player: String,
    val event: String,
    val dims: String,
    val start: Long,
    val granularity: Granularity,
    val count: Long,
    val sum: Double,
    val min: Double,
    val max: Double,
) {
    /** The same bucket with [other]'s records added: same key expected. */
    fun plus(other: BucketRow) = copy(count = count + other.count, sum = sum + other.sum, min = minOf(min, other.min), max = maxOf(max, other.max))
}

/** One row of `artisan_stats_events` without its server and id: [at] in epoch milliseconds, [details] a JSON object. */
data class RawRow(
    val player: String,
    val event: String,
    val at: Long,
    val dims: String,
    val value: Double,
    val details: String,
)

/** What a drain of the buffer hands to the database. */
data class StatsBatch(val buckets: List<BucketRow>, val raws: List<RawRow>) {
    fun isEmpty() = buckets.isEmpty() && raws.isEmpty()

    companion object {
        val EMPTY = StatsBatch(emptyList(), emptyList())
    }
}
