package net.artisanmc.plugin

import net.artisanmc.plugin.engine.CooldownStore
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CooldownStoreTest {

    @Test fun `player not on cooldown initially`() {
        val store = CooldownStore()
        assertFalse(store.isOnCooldown("reward", UUID.randomUUID(), "player"))
    }

    @Test fun `player on cooldown after set with long duration`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("reward", uuid, "player", 3600)
        assertTrue(store.isOnCooldown("reward", uuid, "player"))
    }

    @Test fun `player cooldown expires when duration is zero`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("reward", uuid, "player", 0)
        assertFalse(store.isOnCooldown("reward", uuid, "player"))
    }

    @Test fun `player cooldowns are independent`() {
        val store = CooldownStore()
        val a = UUID.randomUUID()
        val b = UUID.randomUUID()
        store.set("reward", a, "player", 3600)
        assertFalse(store.isOnCooldown("reward", b, "player"))
    }

    @Test fun `global cooldown blocks all players`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("event", uuid, "global", 3600)
        assertTrue(store.isOnCooldown("event", UUID.randomUUID(), "global"))
    }

    @Test fun `global cooldown expires when duration is zero`() {
        val store = CooldownStore()
        store.set("event", UUID.randomUUID(), "global", 0)
        assertFalse(store.isOnCooldown("event", UUID.randomUUID(), "global"))
    }

    @Test fun `different cooldown ids are independent`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("a", uuid, "player", 3600)
        assertFalse(store.isOnCooldown("b", uuid, "player"))
    }

    @Test fun `each cooldown set is reported with its subject and expiry`() {
        val written = mutableListOf<Triple<String, String, Long>>()
        val store = CooldownStore { 1_000L }
        store.onSet = { id, subject, expiresAt -> written += Triple(id, subject, expiresAt) }
        val uuid = UUID.randomUUID()
        store.set("daily", uuid, "player", 60)
        store.set("event", uuid, "global", 5)
        kotlin.test.assertEquals(
            listOf(Triple("daily", uuid.toString(), 61_000L), Triple("event", CooldownStore.GLOBAL, 6_000L)),
            written,
        )
    }

    @Test fun `stored cooldowns apply, the later expiry winning`() {
        var now = 1_000L
        val store = CooldownStore { now }
        val uuid = UUID.randomUUID()
        store.set("daily", uuid, "player", 100)
        store.loadPlayer(uuid, mapOf("daily" to 5_000L, "shop" to 50_000L, "old" to 500L))
        store.loadGlobal(mapOf("event" to 20_000L))
        now = 10_000L
        assertTrue(store.isOnCooldown("daily", uuid, "player"))
        assertTrue(store.isOnCooldown("shop", uuid, "player"))
        assertFalse(store.isOnCooldown("old", uuid, "player"))
        assertTrue(store.isOnCooldown("event", UUID.randomUUID(), "global"))
    }

    @Test fun `prune drops expired entries only`() {
        var now = 0L
        val store = CooldownStore { now }
        val uuid = UUID.randomUUID()
        store.set("short", uuid, "player", 1)
        store.set("long", uuid, "player", 100)
        now = 5_000L
        store.prune()
        assertFalse(store.isOnCooldown("short", uuid, "player"))
        assertTrue(store.isOnCooldown("long", uuid, "player"))
    }
}
