package net.artisanmc.plugin.stats

/**
 * A player's latest value of a declared metric (ADR `stats-export` ②), as buffered and written:
 * [player] is a UUID.
 */
data class MetricValue(val metric: String, val player: String, val value: Long)

/** Where the buffered metric values are written: `artisan_metric_values`. */
fun interface MetricWriter {
    /** Writes [values] at [now] (epoch milliseconds); an unchanged value keeps its old time. Throws on failure. */
    fun write(values: List<MetricValue>, now: Long)
}

/**
 * Metric values waiting for the database: the latest per metric and player, so a value set every
 * minute costs one row per flush. Guarded by one lock: values arrive from every thread (Folia).
 */
class MetricBuffer {
    private val lock = Any()
    private var values = LinkedHashMap<Pair<String, String>, Long>()

    fun set(metric: String, player: String, value: Long) = synchronized(lock) {
        values[metric to player] = value
    }

    /** Everything buffered, and an empty buffer. */
    fun drain(): List<MetricValue> = synchronized(lock) {
        if (values.isEmpty()) return emptyList()
        val out = values.map { (k, v) -> MetricValue(k.first, k.second, v) }
        values = LinkedHashMap()
        out
    }

    /** Values that could not be written, back in, behind any newer value of the same key. */
    fun restore(batch: List<MetricValue>) = synchronized(lock) {
        batch.forEach { values.putIfAbsent(it.metric to it.player, it.value) }
    }

    /** Drops [player]'s buffered values (`/artisan stats forget`). */
    fun forget(player: String) = synchronized(lock) {
        values.keys.removeIf { it.second == player }
        Unit
    }

    fun size(): Int = synchronized(lock) { values.size }
}
