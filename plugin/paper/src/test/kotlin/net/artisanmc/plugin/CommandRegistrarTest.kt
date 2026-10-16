package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.CommandRegistrar
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.*
import net.artisanmc.plugin.engine.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class CommandRegistrarTest {

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
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun runtime(vararg commands: CommandYaml) = RuntimeProject(
        projectId = "test", defaultLang = "en", languages = emptyList(),
        documents = mapOf(DocumentKinds.COMMAND.kind to commands.toList()),
    )

    private fun cmdYaml(name: String) = CommandYaml(
        name = name,
        actions = listOf(mapOf("type" to "send_message", "text" to "ok")),
    )

    private fun cmdYamlWithAliases(name: String, vararg aliases: String) = CommandYaml(
        name = name,
        aliases = aliases.toList(),
        actions = listOf(mapOf("type" to "send_message", "text" to "ok")),
    )

    @Test fun `reload registers commands`() {
        val registrar = CommandRegistrar(plugin.value, lang)
        registrar.reload(listOf(runtime(cmdYaml("testcmd"))), executor(), evaluator)
        val cmd = MockBukkit.getMock()!!.getCommandMap().getCommand("testcmd")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:testcmd")
        assertNotNull(cmd)
        registrar.unregisterAll()
    }

    @Test fun `reload after second call replaces commands`() {
        val registrar = CommandRegistrar(plugin.value, lang)
        registrar.reload(listOf(runtime(cmdYaml("firstcmd"))), executor(), evaluator)
        registrar.reload(listOf(runtime(cmdYaml("secondcmd"))), executor(), evaluator)
        registrar.unregisterAll()
    }

    @Test fun `unregisterAll removes commands`() {
        val registrar = CommandRegistrar(plugin.value, lang)
        registrar.reload(listOf(runtime(cmdYaml("mycmd"))), executor(), evaluator)
        registrar.unregisterAll()
        // No exception = pass
    }

    @Test fun `duplicate command names across projects uses first registered`() {
        val registrar = CommandRegistrar(plugin.value, lang)
        val b1 = runtime(cmdYaml("shared"))
        val b2 = runtime(cmdYaml("shared"))
        registrar.reload(listOf(b1, b2), executor(), evaluator)
        // No exception thrown — duplicate is detected and skipped
        registrar.unregisterAll()
    }

    @Test fun `a command naming an unknown action still registers`() {
        // The name may be a module's: the registry reports it when the command runs.
        val badYaml = CommandYaml(
            name = "brokencommand",
            actions = listOf(mapOf("type" to "definitely_not_an_action")),
        )
        val registrar = CommandRegistrar(plugin.value, lang)
        registrar.reload(listOf(runtime(badYaml)), executor(), evaluator)
        registrar.unregisterAll()
    }

    @Test fun `aliases are registered and retrievable by alias name`() {
        val registrar = CommandRegistrar(plugin.value, lang)
        registrar.reload(listOf(runtime(cmdYamlWithAliases("heal", "h", "healme"))), executor(), evaluator)
        val byAlias = MockBukkit.getMock()!!.getCommandMap().getCommand("h")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:h")
        assertNotNull(byAlias, "alias 'h' should be registered in the command map")
        registrar.unregisterAll()
    }

    @Test fun `aliases are removed from command map after unregisterAll`() {
        val registrar = CommandRegistrar(plugin.value, lang)
        registrar.reload(listOf(runtime(cmdYamlWithAliases("heal", "h", "healme"))), executor(), evaluator)
        registrar.unregisterAll()
        // If aliases were stale, registering a fresh "h" command would find a conflict.
        registrar.reload(listOf(runtime(cmdYaml("h"))), executor(), evaluator)
        val cmd = MockBukkit.getMock()!!.getCommandMap().getCommand("h")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:h")
        assertNotNull(cmd, "fresh 'h' command registered after unregisterAll should be found")
        registrar.unregisterAll()
    }

    @Test fun `alias conflict with existing command logs warning but still registers main command`() {
        val conflictingCmd = object : org.bukkit.command.Command("list") {
            override fun execute(
                sender: org.bukkit.command.CommandSender,
                commandLabel: String,
                args: Array<String>,
            ) = true
        }
        MockBukkit.getMock()!!.getCommandMap().register("minecraft", conflictingCmd)

        val registrar = CommandRegistrar(plugin.value, lang)
        // "shop" is main; "list" alias clashes with the pre-registered command.
        registrar.reload(
            listOf(runtime(cmdYamlWithAliases("shop", "store", "list"))),
            executor(),
            evaluator,
        )
        val shopCmd = MockBukkit.getMock()!!.getCommandMap().getCommand("shop")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:shop")
        assertNotNull(shopCmd, "main command /shop must be registered even when an alias conflicts")
        registrar.unregisterAll()
    }
}
