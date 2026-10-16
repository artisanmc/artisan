package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.model.ContextInputYaml
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.entity.Player
import kotlin.test.*

class MenuSourceContextTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private var openedContext: ExecutionContext? = null
    private val provider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
            openedContext = ctx
        }
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
            openedContext = ctx
        }
    }
    private val executor by lazy {
        ActionExecutor(MockBukkit.load(ArtisanPlugin::class.java), provider, MenuSessionStore(),
            SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)
    }
    private val rows = listOf(mapOf("id" to "keys"))

    private fun rendered(callerArgs: Map<String, Any> = emptyMap()): ExecutionContext {
        val player = MockBukkit.getMock()!!.addPlayer()
        val sources = DataSourceRegistry().apply {
            register(DataSourceDeclaration("boutique:items", { _, _ -> rows }))
        }
        val menu = MenuCompiler.compile(MenuYaml(id = "category", size = 9, contextInputs = listOf(
            ContextInputYaml(name = "items", type = "list", source = mapOf("ref" to "boutique:items")),
        )), emptyMap())
        return MenuRenderer.open(player, menu, "en", ExecutionContext(player, callerArgs), dataSources = sources).ctx
    }

    @Test fun `navigation drops automatically loaded lists and preserves caller parameters`() {
        val ctx = rendered(mapOf("category" to "keys", "discount" to 5))
        assertEquals(rows, ctx.args["items"])
        executor.execute(listOf(Step.ActionStep("open_menu", "main")), ctx)
        assertEquals(mapOf("category" to "keys", "discount" to 5), openedContext!!.args)
    }

    @Test fun `caller supplied source input survives navigation`() {
        val supplied = listOf(mapOf("id" to "tools"))
        val ctx = rendered(mapOf("items" to supplied))
        executor.execute(listOf(Step.ActionStep("open_menu", "main")), ctx)
        assertSame(supplied, openedContext!!.args["items"])
    }

    @Test fun `explicitly forwarding a loaded list keeps its type and survives further navigation`() {
        val ctx = rendered()
        executor.execute(listOf(Step.ActionStep("open_menu", mapOf("menu_id" to "details", "context" to mapOf("items" to "{items}")))), ctx)
        assertSame(ctx.args["items"], openedContext!!.args["items"])
        executor.execute(listOf(Step.ActionStep("open_menu", "next")), openedContext!!)
        assertEquals(rows, openedContext!!.args["items"])
    }

    @Test fun `dialog can read inherited source data but returning to a menu drops it`() {
        val ctx = rendered(mapOf("category" to "keys"))
        executor.execute(listOf(Step.ActionStep("open_dialog", "confirm")), ctx)
        assertEquals(rows, openedContext!!.args["items"])
        executor.execute(listOf(Step.ActionStep("open_menu", "category")), openedContext!!)
        assertEquals(mapOf("category" to "keys"), openedContext!!.args)
    }

    @Test fun `explicitly forwarded dialog source data remains caller data on return`() {
        val ctx = rendered()
        executor.execute(listOf(Step.ActionStep("open_dialog", mapOf("dialog_id" to "confirm", "context" to mapOf("items" to "{items}")))), ctx)
        executor.execute(listOf(Step.ActionStep("open_menu", "category")), openedContext!!)
        assertEquals(rows, openedContext!!.args["items"])
    }
}
