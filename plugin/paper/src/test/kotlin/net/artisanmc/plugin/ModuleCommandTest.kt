package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandContext
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry
import net.artisanmc.plugin.command.CommandOverrideStore
import net.artisanmc.plugin.command.CommandRegistrar
import net.artisanmc.plugin.command.ModuleCommand
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.CommandOverrideYaml
import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.LocalizedText
import net.artisanmc.plugin.model.OverrideCooldownYaml
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.command.Command
import org.bukkit.entity.Player
import java.nio.file.Files
import kotlin.test.*

class ModuleCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val lang = LangManager(
        mapOf("en" to mapOf("cmd.failed" to "failed", "cmd.in_game_only" to "in game", "cmd.usage" to "usage {subcommands}")),
        "en", false,
    )
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, MenuSessionStore(), deps, cooldowns, evaluator)

    private val registry = PlayerCommandRegistry()
    private var overrides: Map<String, CommandOverrideYaml> = emptyMap()
    private val calls = mutableListOf<PlayerCommandContext>()

    private fun registrar() = CommandRegistrar(plugin.value, lang, Scheduler.Direct, registry::declarations) { overrides }

    private fun open(vararg aliases: String) = PlayerCommandDeclaration.builder("attribution:open")
        .name("attribution").aliases(*aliases).executor { calls += it }.build()

    private fun map() = MockBukkit.getMock()!!.commandMap
    private fun command(label: String): Command = assertNotNull(map().getCommand(label), "/$label")

    @Test fun `a declared command is registered under its name and its module prefix`() {
        registry.register(open("source"))
        val registrar = registrar()
        registrar.reload(emptyList(), executor(), evaluator)
        assertIs<ModuleCommand>(command("attribution"))
        assertSame(command("attribution"), command("attribution:attribution"))
        assertSame(command("attribution"), command("source"))
        registrar.unregisterAll()
        assertNull(map().getCommand("attribution"))
    }

    @Test fun `the executor gets typed arguments`() {
        val target = MockBukkit.getMock()!!.addPlayer("Alex")
        val sender = MockBukkit.getMock()!!.addPlayer("Steve")
        registry.register(PlayerCommandDeclaration.builder("attribution:give")
            .argument(CommandArgument.player("target"))
            .argument(CommandArgument.integer("amount").optional())
            .executor { calls += it }.build())
        registrar().reload(emptyList(), executor(), evaluator)
        command("give").execute(sender, "give", arrayOf("Alex", "3"))
        val ctx = calls.single()
        assertEquals("attribution:give", ctx.commandId)
        assertSame(target, ctx.get("target", Player::class.java))
        assertEquals(3, ctx.arguments["amount"])
        assertSame(sender, ctx.player)
    }

    @Test fun `an override renames the root, replaces its aliases and its permission`() {
        registry.register(PlayerCommandDeclaration.builder("attribution:open").name("attribution").aliases("source")
            .permission("attribution.use").executor { calls += it }.build())
        overrides = mapOf("attribution:open" to CommandOverrideYaml(command = "attribution:open", name = "Comment", aliases = listOf("how"), permission = ""))
        registrar().reload(emptyList(), executor(), evaluator)
        val cmd = command("comment")
        assertSame(cmd, command("how"))
        assertSame(cmd, command("attribution:comment"))
        assertNull(map().getCommand("source"))
        assertNull(map().getCommand("attribution"))
        assertNull(cmd.permission)
    }

    @Test fun `a disabled command is not registered`() {
        registry.register(open())
        overrides = mapOf("attribution:open" to CommandOverrideYaml(command = "attribution:open", enabled = false))
        val registrar = registrar()
        registrar.reload(emptyList(), executor(), evaluator)
        assertNull(map().getCommand("attribution"))
        assertFalse(registrar.moduleCommands.single().enabled)
    }

    @Test fun `children are reached by name, a root without executor prints its usage`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        registry.register(PlayerCommandDeclaration.builder("attribution:root").name("attribution")
            .child(PlayerCommandDeclaration.builder("attribution:stats").executor { calls += it }.build())
            .child(PlayerCommandDeclaration.builder("attribution:reset").executor { calls += it }.build())
            .build())
        overrides = mapOf("attribution:reset" to CommandOverrideYaml(command = "attribution:reset", enabled = false))
        registrar().reload(emptyList(), executor(), evaluator)
        val cmd = command("attribution")
        cmd.execute(player, "attribution", arrayOf("stats"))
        assertEquals("attribution:stats", calls.single().commandId)
        cmd.execute(player, "attribution", emptyArray())
        assertEquals("usage stats", player.nextMessage())
        assertEquals(listOf("stats"), cmd.tabComplete(player, "attribution", arrayOf("")))
        cmd.execute(player, "attribution", arrayOf("reset"))
        assertEquals(1, calls.size, "a disabled child does not run")
    }

    @Test fun `the console is refused unless the declaration allows it`() {
        val console = MockBukkit.getMock()!!.consoleSender
        registry.register(open())
        registry.register(PlayerCommandDeclaration.builder("attribution:stats").consoleAllowed(true).executor { calls += it }.build())
        registrar().reload(emptyList(), executor(), evaluator)
        command("attribution").execute(console, "attribution", emptyArray())
        assertTrue(calls.isEmpty())
        command("stats").execute(console, "stats", emptyArray())
        assertNull(calls.single().player)
    }

    @Test fun `an override cooldown stops the second run and speaks the player's language`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        registry.register(open())
        overrides = mapOf("attribution:open" to CommandOverrideYaml(
            command = "attribution:open",
            cooldown = OverrideCooldownYaml(duration = 60, message = LocalizedText.ofMap(mapOf("en" to "wait", "fr" to "attends"))),
        ))
        registrar().reload(emptyList(), executor(), evaluator)
        command("attribution").execute(player, "attribution", emptyArray())
        command("attribution").execute(player, "attribution", emptyArray())
        assertEquals(1, calls.size)
        assertEquals("wait", player.nextMessage())
    }

    @Test fun `a failing executor is logged and the sender told, never thrown`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        registry.register(PlayerCommandDeclaration.builder("attribution:boom").executor { error("boom") }.build())
        registrar().reload(emptyList(), executor(), evaluator)
        command("boom").execute(player, "boom", emptyArray())
        assertEquals("failed", player.nextMessage())
    }

    @Test fun `a project command keeps its name, the module command stays reachable with its prefix`() {
        registry.register(open())
        val project = RuntimeProject(
            projectId = "test", defaultLang = "en", languages = emptyList(),
            documents = mapOf(DocumentKinds.COMMAND.kind to listOf(CommandYaml(name = "attribution", actions = listOf(mapOf("type" to "send_message", "text" to "ok"))))),
        )
        val registrar = registrar()
        registrar.reload(listOf(project), executor(), evaluator)
        assertIs<net.artisanmc.plugin.command.PackCommand>(command("attribution"))
        assertIs<ModuleCommand>(command("attribution:attribution"))
        assertEquals("module command attribution:open", registrar.conflicts.single().loser)
        registrar.unregisterAll()
        assertNull(map().getCommand("attribution:attribution"))
    }

    @Test fun `two module commands renamed alike in one module, the second is not registered`() {
        registry.register(open())
        registry.register(PlayerCommandDeclaration.builder("attribution:stats").executor { calls += it }.build())
        overrides = mapOf("attribution:stats" to CommandOverrideYaml(command = "attribution:stats", name = "attribution"))
        val registrar = registrar()
        registrar.reload(emptyList(), executor(), evaluator)
        assertEquals("attribution:open", (command("attribution:attribution") as ModuleCommand).resolved.id)
        assertEquals("module command attribution:stats", registrar.conflicts.single().loser)
    }

    @Test fun `refresh picks up a command registered after the start`() {
        val registrar = registrar()
        registrar.reload(emptyList(), executor(), evaluator)
        registry.onChange(registrar::refresh)
        registry.register(open())
        assertIs<ModuleCommand>(command("attribution"))
        registry.unregister("attribution:open")
        assertNull(map().getCommand("attribution"))
    }

    @Test fun `overrides are read from every project, a second file for the same id is ignored`() {
        val root = Files.createTempDirectory("overrides").toFile()
        try {
            val a = root.resolve("a/overrides/command").apply { mkdirs() }
            val b = root.resolve("b/overrides/command/attribution").apply { mkdirs() }
            a.resolve("attribution.open.yaml").writeText("schema: command_override/v1\ncommand: attribution:open\nname: source\n")
            b.resolve("open.yaml").writeText("command: attribution:open\nname: other\n")
            b.resolve("broken.yaml").writeText("command: [\n")
            val store = CommandOverrideStore({ mapOf("a" to root.resolve("a"), "b" to root.resolve("b")) }, plugin.value.logger)
            store.reload()
            assertEquals("source", store.overrides.getValue("attribution:open").name)
            assertEquals(1, store.overrides.size)
        } finally {
            root.deleteRecursively()
        }
    }

    private fun balance() = PlayerCommandDeclaration.builder("guilds:root").name("g")
        .child(PlayerCommandDeclaration.builder("guilds:balance").executor { calls += it }
            .child(PlayerCommandDeclaration.builder("guilds:balance.add").name("add")
                .argument(CommandArgument.integer("amount"))
                .permission("guilds.deposit")
                .executor { calls += it }.build())
            .build())
        .build()

    private fun say(text: String) = listOf(mapOf("type" to "send_message", "text" to text))

    @Test fun `steps replace the module's code, on a sub-command too, with its arguments`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        player.addAttachment(plugin.value, "guilds.deposit", true)
        registry.register(balance())
        overrides = mapOf(
            "guilds:balance" to CommandOverrideYaml(command = "guilds:balance", steps = say("menu")),
            "guilds:balance.add" to CommandOverrideYaml(command = "guilds:balance.add", steps = say("confirm {amount}")),
        )
        registrar().reload(emptyList(), executor(), evaluator)
        command("g").execute(player, "g", arrayOf("balance"))
        assertEquals("menu", player.nextMessage())
        command("g").execute(player, "g", arrayOf("balance", "add", "5"))
        assertEquals("confirm 5", player.nextMessage())
        assertTrue(calls.isEmpty(), "the module's code is not called")
    }

    @Test fun `steps never run from the console`() {
        val console = MockBukkit.getMock()!!.consoleSender
        registry.register(PlayerCommandDeclaration.builder("attribution:stats").consoleAllowed(true).executor { calls += it }.build())
        overrides = mapOf("attribution:stats" to CommandOverrideYaml(command = "attribution:stats", steps = say("hi")))
        registrar().reload(emptyList(), executor(), evaluator)
        command("stats").execute(console, "stats", emptyArray())
        assertTrue(calls.isEmpty())
    }

    @Test fun `module_command runs the module's code past the override, typed and permission-checked`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        registry.register(balance())
        overrides = mapOf(
            "guilds:balance.add" to CommandOverrideYaml(
                command = "guilds:balance.add",
                steps = listOf(mapOf("module_command" to mapOf("command" to "guilds:balance.add", "args" to mapOf("amount" to "{amount}")))),
            ),
        )
        val actions = CoreActionHandlers.registry()
        val registrar = registrar()
        actions.register(net.artisanmc.plugin.command.ModuleCommandAction({ registrar.moduleCommands }, lang, plugin.value.logger).declaration())
        val exec = ActionExecutor(plugin.value, stubProvider, MenuSessionStore(), deps, cooldowns, evaluator, registry = actions)
        registrar.reload(emptyList(), exec, evaluator)

        command("g").execute(player, "g", arrayOf("balance", "add", "7"))
        assertTrue(calls.isEmpty(), "without guilds.deposit the command is refused before its chain")

        player.addAttachment(plugin.value, "guilds.deposit", true)
        command("g").execute(player, "g", arrayOf("balance", "add", "7"))
        val ctx = calls.single()
        assertEquals("guilds:balance.add", ctx.commandId)
        assertEquals(7, ctx.arguments["amount"], "the override's chain called its own command once, no loop")
    }

    @Test fun `an override remembers the folder it was read from`() {
        val root = Files.createTempDirectory("overrides").toFile()
        try {
            root.resolve("guilds/overrides/command").apply { mkdirs() }
                .resolve("balance.yaml").writeText("command: guilds:balance\nsteps:\n  - open_menu: solde\n")
            val store = CommandOverrideStore({ mapOf("guilds" to root.resolve("guilds")) }, plugin.value.logger)
            store.reload()
            val override = store.overrides.getValue("guilds:balance")
            assertEquals("guilds", override.project)
            assertNotNull(override.steps)
        } finally {
            root.deleteRecursively()
        }
    }

    private class RecordingProvider : MenuProvider {
        val opened = mutableListOf<Pair<String, Map<String, Any>>>()
        override fun load() {}
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) { opened += menuId to ctx.args }
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }

    private fun shop() = PlayerCommandDeclaration.builder("boutique:open")
        .name("boutique")
        .argument(CommandArgument.string("category").optional())
        .opensMenu("boutique_addon:shop_main")
        .build()

    @Test fun `a command that opens a menu opens it, its arguments as the context, and an override's steps replace it`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        registry.register(shop())
        val provider = RecordingProvider()
        val exec = ActionExecutor(plugin.value, provider, MenuSessionStore(), deps, cooldowns, evaluator)
        val registrar = registrar()
        registrar.reload(emptyList(), exec, evaluator)
        command("boutique").execute(player, "boutique", arrayOf("armes"))
        assertEquals("boutique_addon:shop_main" to mapOf<String, Any>("category" to "armes"), provider.opened.single())

        overrides = mapOf("boutique:open" to CommandOverrideYaml(command = "boutique:open", steps = say("closed")))
        registrar.reload(emptyList(), exec, evaluator)
        command("boutique").execute(player, "boutique", emptyArray())
        assertEquals("closed", player.nextMessage())
        assertEquals(1, provider.opened.size, "the override's steps run instead of the menu")
    }

    @Test fun `a command that opens a menu refuses the console`() {
        val console = MockBukkit.getMock()!!.consoleSender
        registry.register(shop())
        val provider = RecordingProvider()
        registrar().reload(emptyList(), ActionExecutor(plugin.value, provider, MenuSessionStore(), deps, cooldowns, evaluator), evaluator)
        command("boutique").execute(console, "boutique", emptyArray())
        assertTrue(provider.opened.isEmpty())
    }

    @Test fun `module_command opens the declared menu of a command`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        registry.register(shop())
        overrides = mapOf(
            "boutique:open" to CommandOverrideYaml(
                command = "boutique:open",
                steps = listOf(mapOf("module_command" to mapOf("command" to "boutique:open", "args" to mapOf("category" to "{category}")))),
            ),
        )
        val provider = RecordingProvider()
        val actions = CoreActionHandlers.registry()
        val registrar = registrar()
        actions.register(net.artisanmc.plugin.command.ModuleCommandAction({ registrar.moduleCommands }, lang, plugin.value.logger).declaration())
        registrar.reload(emptyList(), ActionExecutor(plugin.value, provider, MenuSessionStore(), deps, cooldowns, evaluator, registry = actions), evaluator)
        command("boutique").execute(player, "boutique", arrayOf("outils"))
        assertEquals("boutique_addon:shop_main" to mapOf<String, Any>("category" to "outils"), provider.opened.single())
    }

    @Test fun `a declaration opens a menu or runs an executor, never both, and never from the console`() {
        assertFailsWith<IllegalArgumentException> {
            PlayerCommandDeclaration.builder("boutique:open").opensMenu("shop_main").executor { }.build()
        }
        assertFailsWith<IllegalArgumentException> {
            PlayerCommandDeclaration.builder("boutique:open").opensMenu("shop_main").consoleAllowed(true).build()
        }
        assertEquals("shop_main", PlayerCommandDeclaration.builder("boutique:open").opensMenu(" shop_main ").build().opensMenu)
    }
}
