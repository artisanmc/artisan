package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.*
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class PackCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(net.artisanmc.plugin.ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val lang = LangManager(emptyMap(), "en", false)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<ProjectBundle> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun cmd(name: String, argDefs: List<ArgDef> = emptyList(), handler: ClickHandler = ClickHandler(emptyList(), emptyList()), permission: String? = null): PackCommand {
        val compiled = CompiledCommand(name, emptyList(), permission, "", argDefs, handler)
        return PackCommand(compiled, executor(), lang)
    }

    @Test fun `a command resolves its menu references in its own project`() {
        var openedFrom: String? = "unset"
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String): BundleMenu? = null
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                openedFrom = ctx.projectId
            }
        }
        val handler = ClickHandler(emptyList(), emptyList(), steps = listOf(Step.ActionStep("open_menu", "main")))
        val compiled = CompiledCommand("shopcmd", emptyList(), null, "", emptyList(), handler)
        val command = PackCommand(
            compiled,
            ActionExecutor(plugin.value, provider, sessions, deps, cooldowns, evaluator),
            lang,
            projectId = "shop",
        )
        command.execute(MockBukkit.getMock()!!.addPlayer(), "shopcmd", emptyArray())
        assertEquals("shop", openedFrom)
    }

    @Test fun `execute sends usage when non-player sender`() {
        val command = cmd("test")
        val console = MockBukkit.getMock()!!.consoleSender
        val result = command.execute(console, "test", emptyArray())
        assertTrue(result)
    }

    @Test fun `execute runs handler for player with no args`() {
        val handler = ClickHandler(
            requirements = emptyList(),
            fallback = emptyList(),
            steps = listOf(Step.ActionStep("send_message", "executed")),
        )
        val command = cmd("test", handler = handler)
        val player = MockBukkit.getMock()!!.addPlayer()
        val result = command.execute(player, "test", emptyArray())
        assertTrue(result)
    }

    @Test fun `command menu navigation carries the configured viewer language`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        player.setLocale(java.util.Locale.FRANCE)
        for ((defaultLang, perPlayer, expected) in listOf(Triple("en", true, "fr"), Triple("en", false, "en"), Triple("fr", false, "fr"))) {
            val languages = LangManager(mapOf("en" to emptyMap(), "fr" to emptyMap()), defaultLang, perPlayer)
            var opened: Pair<String, ExecutionContext>? = null
            val provider = object : MenuProvider {
                override fun load() {}
                override fun findMenu(menuId: String): BundleMenu? = null
                override fun allBundles(): List<ProjectBundle> = emptyList()
                override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                    assertEquals("menu_zdzd", menuId)
                    opened = lang to ctx
                }
            }
            val actions = ActionExecutor(plugin.value, provider, sessions, deps, cooldowns, evaluator)
            val handler = ClickHandler(emptyList(), emptyList(), steps = listOf(Step.ActionStep("open_menu", "menu_zdzd")))
            val command = PackCommand(CompiledCommand("testimg", emptyList(), null, "", emptyList(), handler), actions, languages)
            assertTrue(command.execute(player, "testimg", emptyArray()))
            val (selected, context) = assertNotNull(opened)
            assertEquals(expected, selected)
            assertEquals(selected, context.lang)
        }
    }

    @Test fun `execute returns true when arg parse fails`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val command = cmd("pay", argDefs = defs)
        val player = MockBukkit.getMock()!!.addPlayer()
        val result = command.execute(player, "pay", arrayOf("notanumber"))
        assertTrue(result)
    }

    @Test fun `execute respects command permission`() {
        val command = cmd("admin", permission = "artisan.admin")
        val player = MockBukkit.getMock()!!.addPlayer()
        val result = command.execute(player, "admin", emptyArray())
        assertTrue(result)
    }

    @Test fun `tabComplete delegates to ArgParser`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val command = cmd("rank", argDefs = defs)
        val player = MockBukkit.getMock()!!.addPlayer()
        val completions = command.tabComplete(player, "rank", arrayOf("s"))
        assertEquals(listOf("silver"), completions)
    }
}
