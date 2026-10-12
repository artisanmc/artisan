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
}
