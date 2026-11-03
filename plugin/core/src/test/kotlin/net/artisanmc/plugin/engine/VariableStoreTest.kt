package net.artisanmc.plugin.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VariableStoreTest {
    private var now = 1_000L
    private val store = VariableStore { now }
    private val writes = mutableListOf<Triple<String, String, Any?>>()

    init {
        store.onWrite = { ref, owner, entry -> writes += Triple(ref, owner, entry.value) }
        store.decode = { ref, json -> if (ref == "rpg/coins") json.toDoubleOrNull() else null }
    }

    @Test fun `a value is set, expires, and every write goes to the database hook`() {
        store.set("rpg/coins", "p1", 5.0, expiresSeconds = 10)
        assertEquals(5.0, store.get("rpg/coins", "p1"))
        assertNull(store.get("rpg/coins", "p2"))
        now += 10_000
        assertNull(store.get("rpg/coins", "p1"), "expired")
        assertTrue(store.clear("rpg/coins", "p1").not(), "nothing left to clear")
        assertEquals(listOf(Triple("rpg/coins", "p1", 5.0 as Any?), Triple("rpg/coins", "p1", null)), writes)
    }

    @Test fun `update adds in one step from the current value`() {
        store.update("rpg/coins", "p1", 0) { ((it as? Double) ?: 0.0) + 2 }
        store.update("rpg/coins", "p1", 0) { ((it as? Double) ?: 0.0) + 3 }
        assertEquals(5.0, store.get("rpg/coins", "p1"))
    }

    @Test fun `a load never replaces a newer value, and decodes when read`() {
        store.set("rpg/coins", "p1", 7.0, 0)
        store.load(listOf(
            VariableStore.Stored("rpg/coins", "p1", "1", 0, updatedAt = now - 1),
            VariableStore.Stored("rpg/coins", "p2", "4", 0, updatedAt = now - 1),
            VariableStore.Stored("rpg/gone", "p2", "4", 0, updatedAt = now - 1),
        ))
        assertEquals(7.0, store.get("rpg/coins", "p1"))
        assertEquals(4.0, store.get("rpg/coins", "p2"))
        assertNull(store.get("rpg/gone", "p2"), "no Variable declares it any more")
        store.load(listOf(VariableStore.Stored("rpg/coins", "p1", null, 0, updatedAt = now + 1)))
        assertNull(store.get("rpg/coins", "p1"), "a later clear from another server wins")
    }

    @Test fun `prune drops expired values and old clears`() {
        store.set("rpg/coins", "p1", 1.0, 1)
        store.clear("rpg/coins", "p2")
        now += 11 * 60_000
        store.prune()
        assertNull(store.get("rpg/coins", "p1"))
        // The database keeps the clear a day: what a refresh reads back still hides the older value.
        store.load(listOf(VariableStore.Stored("rpg/coins", "p2", null, 0, updatedAt = 1_000)))
        assertNull(store.get("rpg/coins", "p2"))
    }
}
