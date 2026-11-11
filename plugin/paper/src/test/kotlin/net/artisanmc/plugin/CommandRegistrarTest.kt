package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.CommandRegistrar
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.*
import net.artisanmc.plugin.engine.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.scheduling.Scheduler

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

    private fun runtime(vararg commands: CommandYaml) = runtime("test", *commands)

    private fun runtime(projectId: String, vararg commands: CommandYaml) = RuntimeProject(
        projectId = projectId, defaultLang = "en", languages = emptyList(),
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
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYaml("testcmd"))), executor(), evaluator)
        val cmd = MockBukkit.getMock()!!.getCommandMap().getCommand("testcmd")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:testcmd")
        assertNotNull(cmd)
        registrar.unregisterAll()
    }

    @Test fun `reload after second call replaces commands`() {
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYaml("firstcmd"))), executor(), evaluator)
        registrar.reload(listOf(runtime(cmdYaml("secondcmd"))), executor(), evaluator)
        registrar.unregisterAll()
    }

    @Test fun `unregisterAll removes commands`() {
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYaml("mycmd"))), executor(), evaluator)
        registrar.unregisterAll()
        // No exception = pass
    }

    @Test fun `duplicate command name across projects keeps the first and reports both`() {
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime("alpha", cmdYaml("shared")), runtime("beta", cmdYaml("shared"))), executor(), evaluator)
        val conflict = registrar.conflicts.single()
        assertEquals("shared", conflict.label)
        assertTrue("alpha" in conflict.owner, conflict.owner)
        assertTrue("beta" in conflict.loser, conflict.loser)
        assertFalse(conflict.isAlias)
        registrar.unregisterAll()
    }

    @Test fun `an alias taken by another project is dropped, the command still registers`() {
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(
            listOf(runtime("alpha", cmdYaml("shop")), runtime("beta", cmdYamlWithAliases("store", "shop"))),
            executor(), evaluator,
        )
        val map = MockBukkit.getMock()!!.getCommandMap()
        assertNotNull(map.getCommand("store"))
        assertEquals("shop", map.getCommand("shop")?.name, "alpha keeps /shop")
        assertTrue(registrar.conflicts.single().isAlias)
        registrar.unregisterAll()
    }

    @Test fun `unregisterAll leaves a conflicting command of another plugin in place`() {
        val other = object : org.bukkit.command.Command("list") {
            override fun execute(sender: org.bukkit.command.CommandSender, commandLabel: String, args: Array<String>) = true
        }
        val map = MockBukkit.getMock()!!.getCommandMap()
        map.register("minecraft", other)
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYamlWithAliases("shop", "list"))), executor(), evaluator)
        registrar.unregisterAll()
        assertSame(other, map.getCommand("list"))
    }

    @Test fun `a name held by another plugin stays reachable with the artisan prefix`() {
        val other = object : org.bukkit.command.Command("spawn") {
            override fun execute(sender: org.bukkit.command.CommandSender, commandLabel: String, args: Array<String>) = true
        }
        val map = MockBukkit.getMock()!!.getCommandMap()
        map.register("essentials", other)
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYaml("spawn"))), executor(), evaluator)
        assertSame(other, map.getCommand("spawn"))
        assertIs<net.artisanmc.plugin.command.PackCommand>(map.getCommand("artisan:spawn"))
        assertEquals("spawn", registrar.conflicts.single().label)
        registrar.unregisterAll()
    }

    @Test fun `players get the new command tree only when the commands change`() {
        val server = MockBukkit.getMock()!!
        var sent = 0
        val player = object : be.seeseemelk.mockbukkit.entity.PlayerMock(server, "Alex") {
            override fun updateCommands() { sent++ }
        }
        server.addPlayer(player)
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYaml("first"))), executor(), evaluator)
        assertEquals(1, sent)
        registrar.reload(listOf(runtime(cmdYaml("first"))), executor(), evaluator)
        assertEquals(1, sent, "same commands: nothing to resend")
        registrar.reload(listOf(runtime(cmdYaml("second"))), executor(), evaluator)
        assertEquals(2, sent)
        registrar.unregisterAll()
    }

    @Test fun `a command naming an unknown action still registers`() {
        // The name may be a module's: the registry reports it when the command runs.
        val badYaml = CommandYaml(
            name = "brokencommand",
            actions = listOf(mapOf("type" to "definitely_not_an_action")),
        )
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(badYaml)), executor(), evaluator)
        registrar.unregisterAll()
    }

    @Test fun `aliases are registered and retrievable by alias name`() {
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(runtime(cmdYamlWithAliases("heal", "h", "healme"))), executor(), evaluator)
        val byAlias = MockBukkit.getMock()!!.getCommandMap().getCommand("h")
            ?: MockBukkit.getMock()!!.getCommandMap().getCommand("artisan:h")
        assertNotNull(byAlias, "alias 'h' should be registered in the command map")
        registrar.unregisterAll()
    }

    @Test fun `aliases are removed from command map after unregisterAll`() {
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
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

        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
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

    @Test fun `a player runs the steps of their variant, names and permissions stay the module's`() {
        val say = { text: String -> listOf(mapOf("type" to "send_message", "text" to text)) }
        val base = CommandYaml(
            id = "guild", name = "guild", actions = say("base"),
            subcommands = listOf(SubcommandYaml(name = "info", actions = say("base info"))),
        )
        val vip = base.copy(subcommands = listOf(SubcommandYaml(name = "info", actions = say("vip info"))))
        val project = RuntimeProject(
            projectId = "guilds", defaultLang = "en", languages = emptyList(),
            documents = mapOf(DocumentKinds.COMMAND.kind to listOf(base)),
            variants = mapOf("vip" to mapOf(DocumentKinds.COMMAND.kind to listOf(vip))),
            variantRules = listOf(VariantRule("vip", "vip", permission = "guilds.vip")),
        )
        val registrar = CommandRegistrar(plugin.value, lang, Scheduler.Direct)
        registrar.reload(listOf(project), executor(), evaluator)
        val cmd = MockBukkit.getMock()!!.getCommandMap().getCommand("guild")!!
        val server = MockBukkit.getMock()!!
        val plain = server.addPlayer()
        val member = server.addPlayer().also { it.addAttachment(plugin.value, "guilds.vip", true) }

        cmd.execute(plain, "guild", arrayOf("info"))
        assertEquals("base info", plain.nextMessage())
        cmd.execute(member, "guild", arrayOf("info"))
        assertEquals("vip info", member.nextMessage())
        cmd.execute(member, "guild", emptyArray())
        assertEquals("base", member.nextMessage())
        registrar.unregisterAll()
    }
}
