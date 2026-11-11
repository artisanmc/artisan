package net.artisanmc.plugin.players

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * What the network knows of an online player (`artisan_players`), as of their login: when they
 * were first seen, when they were last seen before this visit, and their play time before it.
 * [sessionStart] is when this server started counting their current session.
 */
data class PlayerRecord(
    val firstSeen: Long,
    /** The end of their previous visit; null on their first visit to the network. */
    val previousSeen: Long?,
    val playtimeBefore: Long,
    val sessionStart: Long,
)

/**
 * The online players' records, read in memory by the templates (`{player.first_seen}`,
 * `{player.last_seen}`, `{player.playtime}`): a text never waits for the database. Filled at login
 * by `PlayerSync` (paper), dropped at quit. Without a database, a player's record starts at their
 * first join on this server since the start.
 */
object PlayerRecords {
    private val online = ConcurrentHashMap<UUID, PlayerRecord>()

    fun get(id: UUID): PlayerRecord? = online[id]

    fun put(id: UUID, record: PlayerRecord) {
        online[id] = record
    }

    fun remove(id: UUID) {
        online.remove(id)
    }

    fun clear() = online.clear()

    /**
     * The template fields of [id] at [now], merged into `{player}`: instants and the play time in
     * epoch milliseconds (`{player.last_seen.ago()}`, `{player.playtime.duration()}`). Empty when
     * nothing is known; `last_seen` absent on a first visit.
     */
    fun fields(id: UUID, now: Long = System.currentTimeMillis()): Map<String, Any?> {
        val r = online[id] ?: return emptyMap()
        return buildMap {
            put("first_seen", r.firstSeen)
            r.previousSeen?.let { put("last_seen", it) }
            put("playtime", r.playtimeBefore + (now - r.sessionStart).coerceAtLeast(0))
        }
    }
}
