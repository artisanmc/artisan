package net.artisanmc.plugin.engine

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The running cooldowns, read in memory only: a check never waits for a database. Each [set]
 * goes to [onSet] too, which keeps them in the suite database (`artisan_cooldowns`, wired by
 * `CooldownSync` in paper) so they outlive a restart and follow a player across the network;
 * what the database holds comes back through [loadPlayer] and [loadGlobal]. Without a
 * database, memory alone.
 */
class CooldownStore(private val clock: () -> Long = System::currentTimeMillis) {
    private val playerCooldowns = ConcurrentHashMap<String, ConcurrentHashMap<UUID, Long>>()
    private val globalCooldowns = ConcurrentHashMap<String, Long>()

    /** Called with (cooldown id, subject, expiry in epoch ms) at each [set]; the subject is the player's UUID, or [GLOBAL]. */
    @Volatile
    var onSet: ((id: String, subject: String, expiresAt: Long) -> Unit)? = null

    fun set(id: String, uuid: UUID, scope: String, durationSeconds: Long) {
        val expiry = clock() + durationSeconds * 1000L
        if (scope == "global") {
            globalCooldowns[id] = expiry
        } else {
            playerCooldowns.getOrPut(id) { ConcurrentHashMap() }[uuid] = expiry
        }
        onSet?.invoke(id, if (scope == "global") GLOBAL else uuid.toString(), expiry)
    }

    fun isOnCooldown(id: String, uuid: UUID, scope: String): Boolean {
        val now = clock()
        return if (scope == "global") {
            val expiry = globalCooldowns[id] ?: return false
            now < expiry
        } else {
            val expiry = playerCooldowns[id]?.get(uuid) ?: return false
            now < expiry
        }
    }

    /** [uuid]'s cooldowns as stored (id → expiry): the later expiry wins, so a load never shortens one set meanwhile. */
    fun loadPlayer(uuid: UUID, stored: Map<String, Long>) {
        val now = clock()
        stored.forEach { (id, expiry) ->
            if (expiry > now) playerCooldowns.getOrPut(id) { ConcurrentHashMap() }.merge(uuid, expiry, ::maxOf)
        }
    }

    /** The server-wide cooldowns as stored (id → expiry), the later expiry winning. */
    fun loadGlobal(stored: Map<String, Long>) {
        val now = clock()
        stored.forEach { (id, expiry) -> if (expiry > now) globalCooldowns.merge(id, expiry, ::maxOf) }
    }

    /** Drops the expired entries: memory does not grow with every player ever seen. */
    fun prune() {
        val now = clock()
        globalCooldowns.values.removeIf { it <= now }
        playerCooldowns.values.forEach { players -> players.values.removeIf { it <= now } }
        playerCooldowns.values.removeIf { it.isEmpty() }
    }

    companion object {
        /** The subject of a `scope: global` cooldown in storage. */
        const val GLOBAL = "*"
    }
}
