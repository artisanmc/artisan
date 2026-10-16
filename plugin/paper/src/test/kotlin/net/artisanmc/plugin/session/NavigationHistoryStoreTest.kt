package net.artisanmc.plugin.session

import be.seeseemelk.mockbukkit.MockBukkit
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NavigationHistoryStoreTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun menu(id: String, vararg args: Pair<String, Any>) =
        NavigationEntry(NavigationEntry.Kind.MENU, id, args.toMap())

    @Test fun `a screen from a project reopens by its qualified ref, never a same-id screen elsewhere`() {
        assertEquals("shop:main", NavigationEntry(NavigationEntry.Kind.MENU, "main", projectId = "shop").ref)
        assertEquals("main", NavigationEntry(NavigationEntry.Kind.MENU, "main").ref)
    }

    @Test fun `pushCurrent then popPrevious is LIFO`() {
        val store = NavigationHistoryStore()
        val p = player()
        store.setCurrent(p, menu("a"))
        store.pushCurrent(p)
        store.setCurrent(p, menu("b"))
        store.pushCurrent(p)
        store.setCurrent(p, menu("c"))

        assertEquals("b", store.popPrevious(p)?.id)
        assertEquals("a", store.popPrevious(p)?.id)
        assertNull(store.popPrevious(p))
    }

    @Test fun `pushCurrent without a known current screen is a no-op`() {
        val store = NavigationHistoryStore()
        val p = player()
        store.pushCurrent(p)
        assertFalse(store.hasPrevious(p))
    }

    @Test fun `back strictly shrinks the stack so screens never ping-pong`() {
        // menu → wiki → item ; two backs must land on menu, not bounce forever.
        val store = NavigationHistoryStore()
        val p = player()
        store.setCurrent(p, menu("menu"))
        store.pushCurrent(p)
        store.setCurrent(p, menu("wiki"))
        store.pushCurrent(p)
        store.setCurrent(p, menu("item"))

        assertEquals("wiki", store.popPrevious(p)?.id) // back from item
        store.setCurrent(p, menu("wiki"))
        assertEquals("menu", store.popPrevious(p)?.id) // back from wiki
        store.setCurrent(p, menu("menu"))
        assertNull(store.popPrevious(p)) // back from menu: empty, no loop
    }

    @Test fun `maxDepth drops the oldest entries`() {
        val store = NavigationHistoryStore(maxDepth = 3)
        val p = player()
        for (id in listOf("a", "b", "c", "d", "e")) {
            store.setCurrent(p, menu(id))
            store.pushCurrent(p)
        }
        // a and b were pushed then dropped; the survivors are c, d, e.
        assertEquals("e", store.popPrevious(p)?.id)
        assertEquals("d", store.popPrevious(p)?.id)
        assertEquals("c", store.popPrevious(p)?.id)
        assertNull(store.popPrevious(p))
    }

    @Test fun `previous peeks without consuming and hasPrevious reflects the stack`() {
        val store = NavigationHistoryStore()
        val p = player()
        assertFalse(store.hasPrevious(p))
        store.setCurrent(p, menu("a"))
        store.pushCurrent(p)
        assertTrue(store.hasPrevious(p))
        assertEquals("a", store.previous(p)?.id)
        assertEquals("a", store.previous(p)?.id) // still there
    }

    @Test fun `clear removes the player's history`() {
        val store = NavigationHistoryStore()
        val p = player()
        store.setCurrent(p, menu("a"))
        store.pushCurrent(p)
        store.setCurrent(p, menu("b"))
        store.clear(p)
        assertFalse(store.hasPrevious(p))
        assertNull(store.previous(p))
    }
}
