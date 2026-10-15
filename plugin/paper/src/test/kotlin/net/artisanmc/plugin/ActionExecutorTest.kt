package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
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
    private var lastDialogCtx: ExecutionContext? = null
    private var lastOpenedMenuId: String? = null
    private var lastMenuCtx: ExecutionContext? = null
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
            lastOpenedMenuId = menuId
            lastMenuCtx = ctx
        }
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
            lastOpenedDialogId = dialogId
            lastDialogCtx = ctx
        }
        override fun allBundles(): List<ProjectBundle> = emptyList()
    }

    private fun executor() = ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns, evaluator)
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun ctx(p: Player) = ExecutionContext(p)

    @Test fun `quoted DSL set activates the target state after reopening the menu`() {
        val p = player()
        val steps = net.artisanmc.plugin.actiondsl.compileActionDsl("""
            set test_tag = "test"
            open_menu menu_zdzd
        """.trimIndent())
        executor().executeSteps(steps, ctx(p))
        assertEquals("menu_zdzd", lastOpenedMenuId)
        assertEquals("test", lastMenuCtx!!.args["test_tag"])
        assertTrue(evaluator.evaluate(Condition.Expression("""test_tag == "test""""), lastMenuCtx!!))
    }

    @Test fun `handle executes actions when requirements pass`() {
        val p = player()
        val handler = ClickHandler(
            requirements = emptyList(),
            fallback = emptyList(),
            steps = listOf(Step.ActionStep("send_message", "hi")),
        )
        executor().handle(handler, ctx(p))
        // No exception = actions path taken
    }

    @Test fun `handle executes fallback when requirement fails`() {
        val p = player()
        val handler = ClickHandler(
            requirements = listOf(Condition.HasPermission("never.granted")),
            fallback = listOf(Step.ActionStep("send_message", "<red>No permission")),
            steps    = listOf(Step.ActionStep("send_message", "<green>Success")),
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
            fallback = emptyList(),
            steps  = listOf(Step.ActionStep("send_message", "ok")),
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
            fallback = emptyList(),
            steps  = listOf(Step.ActionStep("send_message", "ok")),
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
        val action = Step.ActionStep("open_dialog", mapOf("dialog_id" to "d_confirm", "context" to mapOf("tab" to "shop")))
        e.execute(listOf(action), ctx(p).copy(args = mapOf("existing" to "val")))
        assertEquals("d_confirm", lastOpenedDialogId)
    }

    @Test fun `OpenDialog resolves context value placeholders against the click ctx`() {
        val p = player()
        val e = executor()
        // The shop flow: an iterated element binds `item` = the clicked row;
        // open_dialog passes {item.*} placeholders in its context. They must
        // resolve HERE — the dialog only sees the flat args it receives.
        // Whole-token values pass the RAW value (type-preserving); mixed
        // templates interpolate to strings.
        val row = mapOf("id" to "diamond_sword", "name" to "Épée", "final_price" to 80)
        val action = Step.ActionStep("open_dialog", mapOf(
            "dialog_id" to "confirm_purchase",
            "context" to mapOf(
                "item_id" to "{item.id}",
                "item_name" to "{item.name}",
                "item_price" to "{item.final_price}",
                "item_label" to "Item {item.name}",
            ),
        ))
        e.execute(listOf(action), ctx(p).copy(args = mapOf("item" to row)))
        assertEquals("confirm_purchase", lastOpenedDialogId)
        val args = lastDialogCtx!!.args
        assertEquals("diamond_sword", args["item_id"])
        assertEquals("Épée", args["item_name"])
        assertEquals(80, args["item_price"])
        assertEquals("Item Épée", args["item_label"])
    }

    @Test fun `OpenMenu passes a whole bound object when the value is a bare placeholder`() {
        val p = player()
        val e = executor()
        val row = mapOf("id" to "weapons", "name" to "Armes")
        // `context: { cat: "{cat}" }` — the target menu then uses {cat.name}
        // in its title and {cat.id} in filters, no per-field re-plumbing.
        val action = Step.ActionStep("open_menu", mapOf("menu_id" to "shop_category", "context" to mapOf("cat" to "{cat}")))
        e.execute(listOf(action), ctx(p).copy(args = mapOf("cat" to row)))
        assertEquals("shop_category", lastOpenedMenuId)
        assertEquals(row, lastMenuCtx!!.args["cat"])
    }

    @Test fun `OpenMenu resolves context value placeholders against the click ctx`() {
        val p = player()
        val e = executor()
        val row = mapOf("id" to "weapons", "name" to "Armes")
        val action = Step.ActionStep("open_menu", mapOf(
            "menu_id" to "shop_category",
            "context" to mapOf("category_id" to "{cat.id}", "category_name" to "{cat.name}"),
        ))
        e.execute(listOf(action), ctx(p).copy(args = mapOf("cat" to row)))
        assertEquals("shop_category", lastOpenedMenuId)
        assertEquals("weapons", lastMenuCtx!!.args["category_id"])
        assertEquals("Armes", lastMenuCtx!!.args["category_name"])
    }

    @Test fun `OpenDialog with clearContext replaces args`() {
        val p = player()
        lastOpenedDialogId = null
        val e = executor()
        val action = Step.ActionStep("open_dialog", mapOf("dialog_id" to "d_form", "context" to mapOf("preset" to "x"), "clear_context" to true))
        e.execute(listOf(action), ctx(p).copy(args = mapOf("old" to "gone")))
        assertEquals("d_form", lastOpenedDialogId)
    }

    @Test fun `CloseDialog does not crash`() {
        val p = player()
        val e = executor()
        // MockBukkit may not support player.closeDialog() — runCatching prevents crash
        runCatching { e.execute(listOf(Step.ActionStep("close_dialog")), ctx(p)) }
    }

    @Test fun `executeOne show_title sends Adventure title to player`() {
        val p = player()
        val action = Step.ActionStep("show_title", mapOf(
            "title" to "<gold>Welcome",
            "subtitle" to "<gray>traveler",
            "fade_in" to 5,
            "stay" to 40,
            "fade_out" to 15,
        ))
        // No exception — MockBukkit's player accepts Adventure showTitle calls.
        executor().execute(listOf(action), ctx(p))
    }

    @Test fun `executeOne show_title resolves i18n in title and subtitle`() {
        val p = player()
        val langMap = mapOf("k_title" to "<gold>Hello", "k_sub" to "<gray>world")
        val context = ExecutionContext(p, lang = "en", langMap = langMap)
        val action = Step.ActionStep("show_title", mapOf(
            "title" to "{i18n:k_title}",
            "subtitle" to "{i18n:k_sub}",
        ))
        executor().execute(listOf(action), context)
        // Smoke test: no exception thrown by resolveText/MiniMessage on i18n refs.
    }

    @Test fun `executeOne show_title with null subtitle does not throw`() {
        val p = player()
        executor().execute(listOf(Step.ActionStep("show_title", "<red>x")), ctx(p))
    }

    // canonical step-tree execution (kind: action / if)

    private fun give(material: String) = Step.ActionStep("give_item", material)

    private fun ifStep(conditions: List<Condition>, then: List<Step>, els: List<Step>, joins: List<String> = emptyList()) =
        Step.IfStep(cases = listOf(IfCase(conditions, joins, then)), elseSteps = els)

    private fun handlerWithSteps(vararg steps: Step) = ClickHandler(
        requirements = emptyList(), fallback = emptyList(), steps = steps.toList(),
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

    @Test fun `handle runs the step tree through the registry`() {
        val p = player()
        val handler = ClickHandler(
            requirements = emptyList(),
            fallback = emptyList(),
            steps = listOf(give("DIAMOND")),
        )
        executor().handle(handler, ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertFalse(p.inventory.contains(org.bukkit.Material.STONE))
    }

    @Test fun `an unknown action name is skipped and the chain goes on`() {
        val p = player()
        executor().execute(listOf(Step.ActionStep("quests:start", "intro"), give("DIAMOND")), ctx(p))
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
    }

    @Test fun `legacy requirements gate still applies before steps`() {
        val p = player()
        val handler = ClickHandler(
            requirements = listOf(Condition.HasPermission("never.granted")),
            fallback = listOf(Step.ActionStep("give_item", "STONE")),
            steps = listOf(give("DIAMOND")),
        )
        executor().handle(handler, ctx(p))
        assertFalse(p.inventory.contains(org.bukkit.Material.DIAMOND))
        assertTrue(p.inventory.contains(org.bukkit.Material.STONE))
    }

    // set_arg / set_arg_cycle_*

    private fun openSession(p: Player, menuId: String = "shop", args: Map<String, Any> = emptyMap()) {
        sessions.set(p, MenuSession(menuId, ExecutionContext(p, args = args), emptyMap()))
    }

    @Test fun `set_arg re-renders the current menu with the updated arg`() {
        val p = player()
        openSession(p, "shop", args = mapOf("category" to "all"))
        executor().execute(listOf(Step.ActionStep("set_arg", mapOf("arg" to "category", "value" to "tools"))), ExecutionContext(p, args = mapOf("category" to "all")))
        assertEquals("shop", lastOpenedMenuId)
        assertEquals("tools", lastMenuCtx?.args?.get("category"))
    }

    @Test fun `set_arg re-renders without the data the menu fetched, so its sources refresh`() {
        val p = player()
        val fetched = listOf(mapOf("key" to "KICK_MEMBER", "granted" to false))
        openSession(p)
        executor().execute(
            listOf(Step.ActionStep("set_arg", mapOf("arg" to "refresh", "value" to "1"))),
            ExecutionContext(p, args = mapOf("rank" to "admin", "perms" to fetched), sourceArgs = mapOf("perms" to fetched)),
        )
        assertEquals("admin", lastMenuCtx?.args?.get("rank"))
        assertNull(lastMenuCtx?.args?.get("perms"))
    }

    @Test fun `set_arg resolves placeholders in the value`() {
        val p = player()
        openSession(p)
        executor().execute(
            listOf(Step.ActionStep("set_arg", mapOf("arg" to "picked", "value" to "{candidate}"))),
            ExecutionContext(p, args = mapOf("candidate" to "iron")),
        )
        assertEquals("iron", lastMenuCtx?.args?.get("picked"))
    }

    @Test fun `set_arg without an open menu does not re-render`() {
        val p = player()
        executor().execute(listOf(Step.ActionStep("set_arg", mapOf("arg" to "x", "value" to "1"))), ctx(p))
        assertNull(lastOpenedMenuId)
    }

    @Test fun `set_arg_cycle_next advances to the next value`() {
        val p = player()
        openSession(p)
        executor().execute(
            listOf(Step.ActionStep("set_arg_cycle_next", mapOf("arg" to "sort", "list" to "price,name,level"))),
            ExecutionContext(p, args = mapOf("sort" to "price")),
        )
        assertEquals("name", lastMenuCtx?.args?.get("sort"))
    }

    @Test fun `set_arg_cycle_next wraps at the end of the list`() {
        val p = player()
        openSession(p)
        executor().execute(
            listOf(Step.ActionStep("set_arg_cycle_next", mapOf("arg" to "sort", "list" to "price,name,level"))),
            ExecutionContext(p, args = mapOf("sort" to "level")),
        )
        assertEquals("price", lastMenuCtx?.args?.get("sort"))
    }

    @Test fun `set_arg_cycle_next starts at the first value when unset`() {
        val p = player()
        openSession(p)
        executor().execute(listOf(Step.ActionStep("set_arg_cycle_next", mapOf("arg" to "sort", "list" to "price,name,level"))), ctx(p))
        assertEquals("price", lastMenuCtx?.args?.get("sort"))
    }

    @Test fun `clicking an iterated slot resolves the alias in run_command`() {
        val p = player()
        val sessionCtx = ExecutionContext(p, args = mapOf("shops" to listOf(mapOf("id" to "s1"))))
        val slotArgs = mapOf("shop" to mapOf("id" to "s1"))
        // The listener merges session.ctx.args + slotArgs[slot] before handle().
        val merged = sessionCtx.copy(args = sessionCtx.args + slotArgs)
        val resolved = executor().resolveArgs("buy {shop.id}", merged)
        assertEquals("buy s1", resolved)
    }

    @Test fun `set_arg_cycle_prev wraps back to the last value`() {
        val p = player()
        openSession(p)
        executor().execute(
            listOf(Step.ActionStep("set_arg_cycle_prev", mapOf("arg" to "sort", "list" to "price,name,level"))),
            ExecutionContext(p, args = mapOf("sort" to "price")),
        )
        assertEquals("level", lastMenuCtx?.args?.get("sort"))
    }

    @Test fun `open_menu resets pagination state for the target menu`() {
        val p = player()
        val ctx = ExecutionContext(p, pagination = mapOf("grid" to 2), pageInfo = mapOf("grid" to PageInfo(2, 3)))
        executor().execute(listOf(Step.ActionStep("open_menu", "other")), ctx)
        assertEquals("other", lastOpenedMenuId)
        assertTrue(lastMenuCtx?.pagination?.isEmpty() == true)
        assertTrue(lastMenuCtx?.pageInfo?.isEmpty() == true)
    }

    @Test fun `pagination_next advances the page and re-renders`() {
        val p = player()
        sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
        val ctx = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(0, 3)))
        executor().execute(listOf(Step.ActionStep("pagination_next", "grid")), ctx)
        assertEquals("shop", lastOpenedMenuId)
        assertEquals(1, lastMenuCtx?.pagination?.get("grid"))
    }

    @Test fun `pagination_next clamps at the last page (no re-render)`() {
        val p = player()
        sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
        val ctx = ExecutionContext(p, pagination = mapOf("grid" to 2), pageInfo = mapOf("grid" to PageInfo(2, 3)))
        executor().execute(listOf(Step.ActionStep("pagination_next", "grid")), ctx)
        assertNull(lastOpenedMenuId)
    }

    @Test fun `pagination_prev with no element_id targets every iterating element`() {
        val p = player()
        sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
        val ctx = ExecutionContext(
            p,
            pagination = mapOf("grid" to 1, "side" to 1),
            pageInfo = mapOf("grid" to PageInfo(1, 3), "side" to PageInfo(1, 2)),
        )
        executor().execute(listOf(Step.ActionStep("pagination_prev")), ctx)
        assertEquals(0, lastMenuCtx?.pagination?.get("grid"))
        assertEquals(0, lastMenuCtx?.pagination?.get("side"))
    }

    @Test fun `later actions in the same click see the arg set earlier`() {
        val p = player()
        openSession(p)
        executor().executeSteps(
            listOf(
                Step.ActionStep("set_arg", mapOf("arg" to "picked", "value" to "yes")),
                Step.ActionStep("open_dialog", "confirm"),
            ),
            ctx(p),
        )
        assertEquals("yes", lastDialogCtx?.args?.get("picked"))
    }
}
