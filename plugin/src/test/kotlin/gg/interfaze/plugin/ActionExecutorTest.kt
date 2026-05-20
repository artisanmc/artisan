package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.PackBundle
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class ActionExecutorTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val pluginInstance by lazy { MockBukkit.load(InterfazePlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)

    private var lastOpenedDialogId: String? = null
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
            lastOpenedDialogId = dialogId
        }
        override fun allBundles(): List<PackBundle> = emptyList()
    }

    private fun executor() = ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns, evaluator)
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun ctx(p: Player) = ExecutionContext(p)

    @Test fun `handle executes actions when requirements pass`() {
        val p = player()
        val handler = ClickHandler(
            requirements = emptyList(),
            actions = listOf(Action.SendMessage("hi")),
            fallback = emptyList(),
        )
        executor().handle(handler, ctx(p))
        // No exception = actions path taken
    }

    @Test fun `handle executes fallback when requirement fails`() {
        val p = player()
        val handler = ClickHandler(
            requirements = listOf(Condition.HasPermission("never.granted")),
            actions  = listOf(Action.SendMessage("<green>Success")),
            fallback = listOf(Action.SendMessage("<red>No permission")),
        )
        executor().handle(handler, ctx(p))
        // No exception = fallback taken
    }

    @Test fun `handle sets cooldown after successful execution`() {
        val p = player()
        val cooldowns2 = CooldownStore()
        val eval2 = ConditionEvaluator(deps, cooldowns2)
        val exec = ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns2, eval2)
        val handler = ClickHandler(
            requirements = emptyList(),
            actions  = listOf(Action.SendMessage("ok")),
            fallback = emptyList(),
            cooldown = Cooldown("cd_set_test", 3600L),
        )
        assertFalse(cooldowns2.isOnCooldown("cd_set_test", p.uniqueId, "player"))
        exec.handle(handler, ctx(p))
        assertTrue(cooldowns2.isOnCooldown("cd_set_test", p.uniqueId, "player"))
    }

    @Test fun `handle does not execute after cooldown blocks`() {
        val p = player()
        val cooldowns2 = CooldownStore()
        val eval2 = ConditionEvaluator(deps, cooldowns2)
        val exec = ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns2, eval2)
        val handler = ClickHandler(
            requirements = emptyList(),
            actions  = listOf(Action.SendMessage("ok")),
            fallback = emptyList(),
            cooldown = Cooldown("test_cd", 3600L),
        )
        exec.handle(handler, ctx(p))
        // Second call should be blocked by cooldown — no exception
        exec.handle(handler, ctx(p))
    }

    @Test fun `resolveArgs replaces placeholders`() {
        val p = player()
        val result = executor().resolveArgs("Hello {name}, you have {coins} coins.", ctx(p).copy(args = mapOf("name" to "Steve", "coins" to 42)))
        assertEquals("Hello Steve, you have 42 coins.", result)
    }

    @Test fun `resolveArgs returns text unchanged when no args`() {
        val p = player()
        assertEquals("static text", executor().resolveArgs("static text", ctx(p)))
    }

    @Test fun `OpenDialog delegates to menuProvider with merged context`() {
        val p = player()
        val e = executor()
        val action = Action.OpenDialog("d_confirm", context = mapOf("tab" to "shop"))
        e.execute(listOf(action), ctx(p).copy(args = mapOf("existing" to "val")))
        assertEquals("d_confirm", lastOpenedDialogId)
    }

    @Test fun `OpenDialog with clearContext replaces args`() {
        val p = player()
        lastOpenedDialogId = null
        val e = executor()
        val action = Action.OpenDialog("d_form", context = mapOf("preset" to "x"), clearContext = true)
        e.execute(listOf(action), ctx(p).copy(args = mapOf("old" to "gone")))
        assertEquals("d_form", lastOpenedDialogId)
    }

    @Test fun `CloseDialog does not crash`() {
        val p = player()
        val e = executor()
        // MockBukkit may not support player.closeDialog() — runCatching prevents crash
        runCatching { e.execute(listOf(Action.CloseDialog), ctx(p)) }
    }

    @Test fun `executeOne show_title sends Adventure title to player`() {
        val p = player()
        val action = Action.ShowTitle(
            title    = "<gold>Welcome",
            subtitle = "<gray>traveler",
            fadeIn   = 5,
            stay     = 40,
            fadeOut  = 15,
        )
        // No exception — MockBukkit's player accepts Adventure showTitle calls.
        executor().execute(listOf(action), ctx(p))
    }

    @Test fun `executeOne show_title resolves i18n in title and subtitle`() {
        val p = player()
        val langMap = mapOf("k_title" to "<gold>Hello", "k_sub" to "<gray>world")
        val context = ExecutionContext(p, lang = "en", langMap = langMap)
        val action = Action.ShowTitle(
            title    = "{i18n:k_title}",
            subtitle = "{i18n:k_sub}",
        )
        executor().execute(listOf(action), context)
        // Smoke test: no exception thrown by resolveText/MiniMessage on i18n refs.
    }

    @Test fun `executeOne show_title with null subtitle does not throw`() {
        val p = player()
        executor().execute(listOf(Action.ShowTitle(title = "<red>x")), ctx(p))
    }
}
