package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.render.MenuListener
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.entity.Player
import org.bukkit.event.inventory.InventoryCloseEvent
import kotlin.test.*

/** Closing a menu without opening another screen ends the navigation. */
class MenuListenerHistoryTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun tick() = MockBukkit.getMock()!!.scheduler.performOneTick()

    private fun menu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: plain
        title: []
        size: 27
        elements: []
        """.trimIndent(),
    )

    private val sessions = MenuSessionStore()
    private val opened = mutableListOf<String>()

    private fun listener(history: NavigationHistoryStore): MenuListener {
        val plugin = MockBukkit.createMockPlugin()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String) = null
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) { opened += menuId }
        }
        val executor = ActionExecutor(plugin, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY, history = history)
        return MenuListener(plugin, sessions, executor, history = history)
    }

    /** Menu `id` shown after `previous`: the state an `open_menu` leaves. */
    private fun showMenu(p: Player, history: NavigationHistoryStore, id: String, previous: String?, escapeGoesBack: Boolean = false) {
        if (previous != null) {
            history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, previous))
            history.pushCurrent(p)
        }
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, id))
        val runtime = MenuCompiler.compile(menu(), emptyMap()).copy(escapeGoesBack = escapeGoesBack)
        sessions.set(p, MenuRenderer.open(p, runtime, "en", ExecutionContext(p)))
    }

    private fun close(p: Player, l: MenuListener, reason: InventoryCloseEvent.Reason) {
        val view = p.openInventory
        p.closeInventory()
        l.onClose(InventoryCloseEvent(view, reason))
    }

    @Test fun `closing a menu with ESC clears the history next tick`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "b", previous = "a")

        close(p, l, InventoryCloseEvent.Reason.PLAYER)
        assertTrue(history.hasPrevious(p), "cleared only once the tick confirms nothing else opened")
        tick()
        assertFalse(history.hasPrevious(p))
        assertNull(history.current(p))
    }

    @Test fun `going from menu A to menu B keeps the history`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "a", previous = "root")
        val viewA = p.openInventory
        // open_menu B: push A, record B, open B — then Bukkit closes A.
        history.pushCurrent(p)
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "b"))
        MenuRenderer.open(p, MenuCompiler.compile(menu(), emptyMap()), "en")

        l.onClose(InventoryCloseEvent(viewA))
        tick()
        assertEquals("b", history.current(p)?.id)
        assertEquals("a", history.previous(p)?.id)
    }

    @Test fun `opening a dialog from a menu keeps the history`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "a", previous = "root")
        val viewA = p.openInventory
        // open_dialog: push A, record the dialog, which closes A's inventory.
        history.pushCurrent(p)
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.DIALOG, "confirm"))
        p.closeInventory()

        l.onClose(InventoryCloseEvent(viewA))
        tick()
        assertEquals("confirm", history.current(p)?.id)
        assertEquals("a", history.previous(p)?.id)
    }

    @Test fun `ESC reopens the previous menu when the project has escape_goes_back`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "b", previous = "a", escapeGoesBack = true)

        close(p, l, InventoryCloseEvent.Reason.PLAYER)
        tick()
        assertEquals(listOf("a"), opened)
        assertFalse(history.hasPrevious(p), "going back consumes the entry")
    }

    @Test fun `close_menu still closes everything with escape_goes_back`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "b", previous = "a", escapeGoesBack = true)

        close(p, l, InventoryCloseEvent.Reason.PLUGIN)
        tick()
        assertTrue(opened.isEmpty())
        assertFalse(history.hasPrevious(p))
    }

    @Test fun `ESC on the root menu closes it with escape_goes_back`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "root", previous = null, escapeGoesBack = true)

        close(p, l, InventoryCloseEvent.Reason.PLAYER)
        tick()
        assertTrue(opened.isEmpty())
        assertNull(history.current(p))
    }
}
