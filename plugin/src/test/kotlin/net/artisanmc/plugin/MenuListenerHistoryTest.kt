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

/** Fermer un menu sans ouvrir d'autre écran termine la navigation. */
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

    private fun listener(history: NavigationHistoryStore): MenuListener {
        val plugin = MockBukkit.createMockPlugin()
        val sessions = MenuSessionStore()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String) = null
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        }
        val executor = ActionExecutor(plugin, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)
        return MenuListener(plugin, sessions, executor, history = history)
    }

    /** Menu `id` affiché après `previous` : l'état que laisse un `open_menu`. */
    private fun showMenu(p: Player, history: NavigationHistoryStore, id: String, previous: String) {
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, previous))
        history.pushCurrent(p)
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, id))
        MenuRenderer.open(p, BundleCompiler.compile(menu(), emptyMap()), "en")
    }

    @Test fun `closing a menu with ESC clears the history next tick`() {
        val p = player()
        val history = NavigationHistoryStore()
        val l = listener(history)
        showMenu(p, history, "b", previous = "a")

        val view = p.openInventory
        p.closeInventory()
        l.onClose(InventoryCloseEvent(view))
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
        MenuRenderer.open(p, BundleCompiler.compile(menu(), emptyMap()), "en")

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
}
