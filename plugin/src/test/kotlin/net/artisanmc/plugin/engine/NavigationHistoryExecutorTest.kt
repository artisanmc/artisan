package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * End-to-end shape of the back button: the executor pushes on navigation and the
 * provider records the screen it just presented — mirroring production, where
 * `SyncedMenuProvider.openMenu`/`openDialog` call `history.setCurrent`.
 */
class NavigationHistoryExecutorTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val history = NavigationHistoryStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)

    private val opened = mutableListOf<String>()

    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
            opened.add("menu:$menuId")
            history.setCurrent(
                player,
                NavigationEntry(NavigationEntry.Kind.MENU, menuId, ctx.navigationArgs, ctx.pagination, lang),
            )
        }
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
            opened.add("dialog:$dialogId")
            history.setCurrent(player, NavigationEntry(NavigationEntry.Kind.DIALOG, dialogId, ctx.args, lang = lang))
        }
        override fun allBundles(): List<ProjectBundle> = emptyList()
    }

    private fun executor() = ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns, evaluator, null, history)
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun ctx(p: Player, args: Map<String, Any> = emptyMap()) = ExecutionContext(p, args = args)

    @Test fun `navigate pushes the outgoing screen and records the new one`() {
        val p = player()
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "menu"))
        executor().execute(listOf(Action.OpenMenu("wiki")), ctx(p))
        assertTrue(history.hasPrevious(p))
        assertEquals("menu", history.previous(p)?.id)
        assertEquals("wiki", history.current(p)?.id)
    }

    @Test fun `two backs from menu-wiki-item land on menu then stop (no loop)`() {
        val p = player()
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "menu"))
        executor().execute(listOf(Action.OpenMenu("wiki")), ctx(p))
        executor().execute(listOf(Action.OpenMenu("item")), ctx(p))
        opened.clear()

        executor().execute(listOf(Action.OpenPreviousMenu), ctx(p))
        executor().execute(listOf(Action.OpenPreviousMenu), ctx(p))
        executor().execute(listOf(Action.OpenPreviousMenu), ctx(p))

        assertEquals(listOf("menu:wiki", "menu:menu"), opened)
        assertFalse(history.hasPrevious(p))
    }

    @Test fun `back restores the previous screen's args and page`() {
        val p = player()
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "menu", args = mapOf("cat" to "armor")))
        history.pushCurrent(p) // as if navigating away
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "item"))

        executor().execute(listOf(Action.OpenPreviousMenu), ctx(p))
        assertEquals("menu:menu", opened.single())
        assertEquals("armor", history.current(p)?.args?.get("cat"))
    }

    @Test fun `back with an empty stack is a no-op`() {
        val p = player()
        executor().execute(listOf(Action.OpenPreviousMenu), ctx(p))
        assertTrue(opened.isEmpty())
    }

    @Test fun `set_arg does not push history (re-render is not navigation)`() {
        val p = player()
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "shop"))
        sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
        executor().execute(listOf(Action.SetArg("cat", "tools")), ctx(p))
        assertFalse(history.hasPrevious(p))
    }

    @Test fun `opening a dialog also pushes`() {
        val p = player()
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "menu"))
        executor().execute(listOf(Action.OpenDialog("confirm")), ctx(p))
        assertEquals("menu", history.previous(p)?.id)
        assertEquals("dialog:confirm", opened.single())
    }

    @Test fun `back can return to a dialog`() {
        val p = player()
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.DIALOG, "confirm"))
        history.pushCurrent(p)
        history.setCurrent(p, NavigationEntry(NavigationEntry.Kind.MENU, "menu"))
        executor().execute(listOf(Action.OpenPreviousMenu), ctx(p))
        assertEquals("dialog:confirm", opened.single())
    }
}
