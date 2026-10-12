package net.artisanmc.plugin.engine

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class CooldownStore {
    private val playerCooldowns = ConcurrentHashMap<String, ConcurrentHashMap<UUID, Long>>()
    private val globalCooldowns = ConcurrentHashMap<String, Long>()

    fun set(id: String, uuid: UUID, scope: String, durationSeconds: Long) {
        val expiry = System.currentTimeMillis() + durationSeconds * 1000L
        if (scope == "global") {
            globalCooldowns[id] = expiry
        } else {
            playerCooldowns.getOrPut(id) { ConcurrentHashMap() }[uuid] = expiry
        }
    }

    fun isOnCooldown(id: String, uuid: UUID, scope: String): Boolean {
        val now = System.currentTimeMillis()
        return if (scope == "global") {
            val expiry = globalCooldowns[id] ?: return false
            now < expiry
        } else {
            val expiry = playerCooldowns[id]?.get(uuid) ?: return false
            now < expiry
        }
    }
}
