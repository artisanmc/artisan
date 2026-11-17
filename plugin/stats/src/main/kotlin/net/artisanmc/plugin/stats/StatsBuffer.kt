package net.artisanmc.plugin.stats

/**
 * Records waiting for the database (ADR `stats-foundation` ④): buckets merged by player, event,
 * dimensions and hour, raw rows in arrival order, at most [maxRaw] of them (the oldest dropped
 * first). Every call is short and guarded by one lock: records arrive from every thread (Folia).
 */
class StatsBuffer(private val maxRaw: Int = DEFAULT_MAX_RAW) {
    private data class Key(val player: String, val event: String, val dims: String, val start: Long, val granularity: Granularity)

    private val lock = Any()
    private var buckets = HashMap<Key, BucketRow>()
    private var raws = ArrayDeque<RawRow>()
    private var dropped = 0L

    fun addBucket(row: BucketRow) = synchronized(lock) {
        buckets.merge(Key(row.player, row.event, row.dims, row.start, row.granularity), row, BucketRow::plus)
        Unit
    }

    fun addRaw(row: RawRow) = synchronized(lock) {
        raws.addLast(row)
        trim()
    }

    /** Everything buffered, and an empty buffer. */
    fun drain(): StatsBatch = synchronized(lock) {
        if (buckets.isEmpty() && raws.isEmpty()) return StatsBatch.EMPTY
        val batch = StatsBatch(buckets.values.toList(), raws.toList())
        buckets = HashMap()
        raws = ArrayDeque()
        batch
    }

    /** A [batch] that could not be written, back in: its buckets merge with the newer ones, its raw rows go first. */
    fun restore(batch: StatsBatch) = synchronized(lock) {
        batch.buckets.forEach { row -> buckets.merge(Key(row.player, row.event, row.dims, row.start, row.granularity), row, BucketRow::plus) }
        val newer = raws
        raws = ArrayDeque(batch.raws)
        raws.addAll(newer)
        trim()
    }

    /** Drops [player]'s buffered records (`/artisan stats forget`). */
    fun forget(player: String) = synchronized(lock) {
        buckets.keys.removeIf { it.player == player }
        raws.removeAll { it.player == player }
        Unit
    }

    /** Raw rows dropped for lack of room since the start. */
    fun dropped(): Long = synchronized(lock) { dropped }

    fun size(): Int = synchronized(lock) { buckets.size + raws.size }

    private fun trim() {
        while (raws.size > maxRaw) {
            raws.removeFirst()
            dropped++
        }
    }

    companion object {
        const val DEFAULT_MAX_RAW = 100_000
    }
}
