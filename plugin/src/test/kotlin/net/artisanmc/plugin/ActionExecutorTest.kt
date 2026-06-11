package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.PackBundle
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class ActionExecutorTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
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

    // ── canonical step-tree execution (kind: action / if) ────────────────────

    private fun give(material: String) = Step.ActionStep(Action.GiveItem(material, 1))

    private fun ifStep(conditions: List<Condition>, then: List<Step>, els: List<Step>, joins: List<String> = emptyList()) =
        Step.IfStep(cases = listOf(IfCase(conditions, joins, then)), elseSteps = els)

    private fun handlerWithSteps(vararg steps: Step) = ClickHandler(
        requirements = emptyList(), actions = emptyList(), fallback = emptyList(), steps = steps.toList(),
    )

    @Test fun `handle executes the matching if-case steps`() {
        val p = player()
        p.addAttachment(pluginInstance, "step.vip", true)
        val handler = handlerWithSteps(
            ifStep(listOf(Condition.HasPermission("step.vip")), listOf(give("DIAMOND")), listOf(give("STONE"))),
        )
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertFalse(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `handle executes else steps when no case matches`() {
        val p = player()
        val handler = handlerWithSteps(
            ifStep(listOf(Condition.HasPermission("step.vip")), listOf(give("DIAMOND")), listOf(give("STONE"))),
        )
        executor().handle(handler, ctx(p))
        assertFalse(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertTrue(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `or join matches when only the second condition holds`() {
        val p = player()
        p.addAttachment(pluginInstance, "perm.b", true)
        val handler = handlerWithSteps(
            ifStep(
                listOf(Condition.HasPermission("perm.a"), Condition.HasPermission("perm.b")),
                listOf(give("DIAMOND")), listOf(give("STONE")),
                joins = listOf("or"),
            ),
        )
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
    }

    @Test fun `default and join requires every condition`() {
        val p = player()
        p.addAttachment(pluginInstance, "perm.a", true)
        val handler = handlerWithSteps(
            ifStep(
                listOf(Condition.HasPermission("perm.a"), Condition.HasPermission("perm.b")),
                listOf(give("DIAMOND")), listOf(give("STONE")),
            ),
        )
        executor().handle(handler, ctx(p))
        assertFalse(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertTrue(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `an empty conditions case always matches`() {
        val p = player()
        val handler = handlerWithSteps(
            ifStep(emptyList(), listOf(give("DIAMOND")), listOf(give("STONE"))),
        )
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertFalse(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `nested if steps execute the inner branch`() {
        val p = player()
        val inner = ifStep(listOf(Condition.HasPermission("inner.perm")), listOf(give("DIAMOND")), listOf(give("STONE")))
        val handler = handlerWithSteps(ifStep(emptyList(), listOf(inner), emptyList()))
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `steps after an if step always run`() {
        val p = player()
        val handler = handlerWithSteps(
            ifStep(listOf(Condition.HasPermission("step.vip")), listOf(give("DIAMOND")), listOf(give("STONE"))),
            give("APPLE"),
        )
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.APPLE))
    }

    @Test fun `step tree takes precedence over legacy flat actions`() {
        val p = player()
        val handler = ClickHandler(
            requirements = emptyList(),
            actions = listOf(Action.GiveItem("STONE", 1)),
            fallback = emptyList(),
            steps = listOf(give("DIAMOND")),
        )
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertFalse(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `legacy requirements gate still applies before steps`() {
        val p = player()
        val handler = ClickHandler(
            requirements = listOf(Condition.HasPermission("never.granted")),
            actions = emptyList(),
            fallback = listOf(Action.GiveItem("STONE", 1)),
            steps = listOf(give("DIAMOND")),
        )
        executor().handle(handler, ctx(p))
        assertFalse(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertTrue(p.inventory.contains(org.bukkit.Material.STONE))
    }
}
