package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.MenuRefresher
import net.artisanmc.plugin.engine.MenuSession
import net.artisanmc.plugin.engine.MenuSessionStore
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

/** `api.menus` and `refresh_interval` repaint the open menu without reopening it. */
class MenuRefresherTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val opened = mutableListOf<String>()
    private val repainted = mutableListOf<Pair<String, ExecutionContext>>()
    private val provider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) { opened += menuId }
        override fun repaintMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
            repainted += menuId to ctx
        }
    }
    private val sessions = MenuSessionStore()
    private val refresher = MenuRefresher(sessions) { provider }
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    @Test fun `refresh repaints the open menu with its navigation args and without what it fetched`() {
        val p = player()
        val ctx = ExecutionContext(p, args = mapOf("tab" to "weapons", "listings" to listOf(1)),
            sourceArgs = mapOf("listings" to listOf(1)), lang = "fr")
        // Same instance as in args: a fetched value, dropped so the source runs again.
        sessions.set(p, MenuSession("ah_main", ctx.copy(sourceArgs = mapOf("listings" to ctx.args["listings"]!!)), emptyMap()))
        assertTrue(refresher.refresh(p))
        val (menu, sent) = repainted.single()
        assertEquals("ah_main", menu)
        assertEquals(mapOf<String, Any>("tab" to "weapons"), sent.args)
        assertEquals("fr", sent.lang)
        assertTrue(opened.isEmpty())
    }

    @Test fun `refresh without an open menu does nothing`() {
        assertFalse(refresher.refresh(player()))
        assertTrue(repainted.isEmpty())
    }

    @Test fun `refreshAll repaints only the viewers of that menu`() {
        val a = player(); val b = player(); val c = player()
        sessions.set(a, MenuSession("ah_main", ExecutionContext(a), emptyMap()))
        sessions.set(b, MenuSession("ah_main", ExecutionContext(b), emptyMap()))
        sessions.set(c, MenuSession("shop", ExecutionContext(c), emptyMap()))
        assertEquals(2, refresher.refreshAll("ah_main"))
        assertEquals(listOf("ah_main", "ah_main"), repainted.map { it.first })
        assertEquals("shop", refresher.openMenuId(c))
    }

    @Test fun `tick follows each menu's refresh_interval`() {
        val p = player(); val q = player()
        sessions.set(p, MenuSession("every2", ExecutionContext(p), emptyMap(), refreshInterval = 2))
        sessions.set(q, MenuSession("never", ExecutionContext(q), emptyMap()))
        repeat(4) { refresher.tick() }
        assertEquals(listOf("every2", "every2"), repainted.map { it.first })
    }
}
