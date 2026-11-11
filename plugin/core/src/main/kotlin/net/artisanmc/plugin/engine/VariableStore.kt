package net.artisanmc.plugin.engine

import java.util.concurrent.ConcurrentHashMap

/**
 * The values of the Project variables (ADR `triggers-and-variables` §5), read in memory only: a
 * condition never waits for a database. Each write goes to [onWrite] too, which keeps it in the
 * suite database (`artisan_vars`, wired by `VariableSync` in paper) so it outlives a restart and
 * follows a player across the network; what the database holds comes back through [load]. Same
 * scheme as [CooldownStore]: memory decides, the database is the copy.
 *
 * Values are stored as written (typed by the Variable); the owner is a player's UUID, or [SERVER].
 * A clear is kept as a tombstone until it is older than any value a load could bring back.
 */
class VariableStore(private val clock: () -> Long = System::currentTimeMillis) {
    /** One value; [value] null: cleared at [updatedAt]. */
    data class Entry(val value: Any?, val expiresAt: Long, val updatedAt: Long) {
        fun live(now: Long): Boolean = value != null && (expiresAt == 0L || now < expiresAt)
    }

    /** A stored row: the JSON value (null: cleared), its expiry (0: none), when it was written. */
    data class Stored(val ref: String, val owner: String, val value: String?, val expiresAt: Long, val updatedAt: Long)

    private val entries = ConcurrentHashMap<Pair<String, String>, Entry>()

    /** Called at each write with (variable ref, owner, entry). */
    @Volatile
    var onWrite: ((ref: String, owner: String, entry: Entry) -> Unit)? = null

    /**
     * A stored JSON value as its Variable's type, or null (Variable unknown, type changed). Applied
     * at read time: rows may load before the projects that declare their Variables.
     */
    @Volatile
    var decode: (ref: String, json: String) -> Any? = { _, _ -> null }

    /** A value read from the database, not decoded yet. */
    private class Raw(val json: String)

    /** The value of [ref] for [owner], or null: never written, cleared, expired, or no longer of its Variable's type. */
    fun get(ref: String, owner: String): Any? {
        val entry = entries[ref to owner]?.takeIf { it.live(clock()) } ?: return null
        val raw = entry.value as? Raw ?: return entry.value
        val value = decode(ref, raw.json) ?: return null
        entries.replace(ref to owner, entry, entry.copy(value = value))
        return value
    }

    /** Sets [ref] for [owner]; [expiresSeconds] 0 keeps it until the next write. */
    fun set(ref: String, owner: String, value: Any, expiresSeconds: Long) {
        val now = clock()
        write(ref, owner, Entry(value, if (expiresSeconds > 0) now + expiresSeconds * 1000 else 0L, now))
    }

    /** Clears [ref] for [owner]; true when it held a value. */
    fun clear(ref: String, owner: String): Boolean {
        val had = get(ref, owner) != null
        write(ref, owner, Entry(null, 0L, clock()))
        return had
    }

    /**
     * Updates [ref] for [owner] from its current value (null when absent) in one step, so two
     * `add_var` on the same value do not lose one; null from [update] leaves it unchanged.
     */
    fun update(ref: String, owner: String, expiresSeconds: Long, update: (Any?) -> Any?): Any? {
        var written: Entry? = null
        entries.compute(ref to owner) { _, current ->
            val now = clock()
            val live = current?.takeIf { it.live(now) }?.let { c -> (c.value as? Raw)?.let { decode(ref, it.json) } ?: c.value.takeIf { it !is Raw } }
            val next = update(live) ?: return@compute current
            Entry(next, if (expiresSeconds > 0) now + expiresSeconds * 1000 else 0L, now).also { written = it }
        }
        written?.let { onWrite?.invoke(ref, owner, it) }
        return written?.value
    }

    private fun write(ref: String, owner: String, entry: Entry) {
        entries[ref to owner] = entry
        onWrite?.invoke(ref, owner, entry)
    }

    /**
     * Rows read from the database. A row older than what memory holds is ignored: a value set
     * while the read was on its way is not overwritten by the older one.
     */
    fun load(rows: List<Stored>) {
        for (row in rows) {
            val loaded = Entry(row.value?.let(::Raw), row.expiresAt, row.updatedAt)
            entries.merge(row.ref to row.owner, loaded) { current, new -> if (new.updatedAt > current.updatedAt) new else current }
        }
    }

    /** Drops expired values and tombstones older than [keepTombstonesMs]: memory does not grow forever. */
    fun prune(keepTombstonesMs: Long = 10 * 60_000L) {
        val now = clock()
        entries.values.removeIf { e ->
            if (e.value == null) now - e.updatedAt > keepTombstonesMs
            else e.expiresAt != 0L && now >= e.expiresAt
        }
    }

    companion object {
        /** The owner of a `scope: server` value. */
        const val SERVER = "*"
    }
}
