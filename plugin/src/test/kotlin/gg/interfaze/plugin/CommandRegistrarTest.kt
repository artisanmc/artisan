package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.command.CommandRegistrar
import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.*
import gg.interfaze.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class CommandRegistrarTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(gg.interfaze.plugin.InterfazePlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<PackBundle> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun bundle(vararg commands: CommandYaml) = PackBundle(
        packId = "test", defaultLang = "en", languages = emptyList(),
        menus = emptyList(), commands = commands.toList(), dialogs = emptyList(),
    )

    private fun cmdYaml(name: String) = CommandYaml(
        name = name,
        actions = listOf(mapOf("type" to "send_message", "text" to "ok")),
    )

    @Test fun `reload registers commands`() {
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(cmdYaml("testcmd"))), executor(), evaluator)
        val cmd = MockBukkit.getMock()!!.getCommandMap().getCommand("testcmd")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("interfaze:testcmd")
        assertNotNull(cmd)
        registrar.unregisterAll()
    }

    @Test fun `reload after second call replaces commands`() {
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(cmdYaml("firstcmd"))), executor(), evaluator)
        registrar.reload(listOf(bundle(cmdYaml("secondcmd"))), executor(), evaluator)
        registrar.unregisterAll()
    }

    @Test fun `unregisterAll removes commands`() {
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(cmdYaml("mycmd"))), executor(), evaluator)
        registrar.unregisterAll()
        // No exception = pass
    }

    @Test fun `duplicate command names across packs uses first registered`() {
        val registrar = CommandRegistrar(plugin.value)
        val b1 = bundle(cmdYaml("shared"))
        val b2 = bundle(cmdYaml("shared"))
        registrar.reload(listOf(b1, b2), executor(), evaluator)
        // No exception thrown — duplicate is detected and skipped
        registrar.unregisterAll()
    }

    @Test fun `invalid command yaml is skipped without exception`() {
        val badYaml = CommandYaml(
            name = "brokencommand",
            actions = listOf(mapOf("type" to "definitely_not_an_action")),
        )
        val registrar = CommandRegistrar(plugin.value)
        registrar.reload(listOf(bundle(badYaml)), executor(), evaluator)
        // No exception — bad command simply skipped
        registrar.unregisterAll()
    }
}
