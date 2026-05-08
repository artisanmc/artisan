package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.command.*
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.lang.LangManager
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.PackBundle
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class PackCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(gg.interfaze.plugin.InterfazePlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val lang = LangManager(emptyMap(), "en", false)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<PackBundle> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun cmd(name: String, argDefs: List<ArgDef> = emptyList(), handler: ClickHandler = ClickHandler(emptyList(), emptyList(), emptyList()), permission: String? = null): PackCommand {
        val compiled = CompiledCommand(name, emptyList(), permission, "", argDefs, handler)
        return PackCommand(compiled, executor(), lang)
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
            actions = listOf(Action.SendMessage("executed")),
            fallback = emptyList(),
        )
        val command = cmd("test", handler = handler)
        val player = MockBukkit.getMock()!!.addPlayer()
        val result = command.execute(player, "test", emptyArray())
        assertTrue(result)
    }

    @Test fun `execute returns true when arg parse fails`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val command = cmd("pay", argDefs = defs)
        val player = MockBukkit.getMock()!!.addPlayer()
        val result = command.execute(player, "pay", arrayOf("notanumber"))
        assertTrue(result)
    }

    @Test fun `execute respects command permission`() {
        val command = cmd("admin", permission = "interfaze.admin")
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
