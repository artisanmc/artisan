package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandContext
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry
import net.artisanmc.plugin.command.CommandRegistrar
import net.artisanmc.plugin.command.ModuleCommandAction
import net.artisanmc.plugin.command.ModuleCommandFiles
import net.artisanmc.plugin.command.PackCommand
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.command.Command
import org.bukkit.entity.Player
import kotlin.test.*

/**
 * A module's commands: `command/v1` files of its folder (`ModuleCommandFiles`), registered from
 * memory while it has none, their actions calling its code through `module_command`.
 */
class ModuleCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val lang = LangManager(
        mapOf("en" to mapOf(
            "cmd.failed" to "failed", "cmd.in_game_only" to "in game", "cmd.usage" to "usage {subcommands}",
            "cmd.no_permission" to "no permission",
        )),
        "en", false,
    )

    private class RecordingProvider : MenuProvider {
        val opened = mutableListOf<Pair<String, Map<String, Any>>>()
        override fun load() {}
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) { opened += menuId to ctx.args }
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }
    private val provider = RecordingProvider()

    private val registry = PlayerCommandRegistry()
    private val calls = mutableListOf<PlayerCommandContext>()
    /** project id → the module owning that folder. */
    private val folders = mutableMapOf<String, String>()

    private lateinit var registrar: CommandRegistrar
    private val action = lazy { ModuleCommandAction(registry::find, { registrar.permissionsOf(it) }, lang, plugin.value.logger) }
    private val executor = lazy {
        val actions = CoreActionHandlers.registry().apply { register(action.value.declaration()) }
        ActionExecutor(plugin.value, provider, MenuSessionStore(), deps, cooldowns, evaluator, registry = actions)
    }

    private fun reload(vararg projects: RuntimeProject): CommandRegistrar {
        if (!::registrar.isInitialized) {
            registrar = CommandRegistrar(
                plugin.value, lang, Scheduler.Direct, registry::declarations,
                commandOwner = registry::ownerOf, folderOwner = folders::get, consoleRunner = action.value,
            )
        }
        registrar.reload(projects.toList(), executor.value, evaluator)
        return registrar
    }

    /** Registers [declaration] as module [module]'s, as its `onEnable` would. */
    private fun declare(declaration: PlayerCommandDeclaration, module: String = declaration.namespace()) {
        registry.bindOwner(module)
        try { registry.register(declaration) } finally { registry.bindOwner(null) }
    }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    /** Folder [projectId] holding command files `id → yaml`, owned by [module] (null: an admin's). */
    private fun project(projectId: String, module: String?, vararg files: Pair<String, String>): RuntimeProject {
        if (module != null) folders[projectId] = module
        return RuntimeProject(
            projectId = projectId, defaultLang = "en", languages = emptyList(),
            documents = mapOf(DocumentKinds.COMMAND.kind to files.map { (id, yaml) -> mapper.readValue(yaml, CommandYaml::class.java).copy(id = id) }),
        )
    }

    /** The module's generated file of [declaration], edited by [edit]. */
    private fun edited(declaration: PlayerCommandDeclaration, edit: (String) -> String) = declaration.name to edit(ModuleCommandFiles.yaml(declaration))

    private fun open(vararg aliases: String) = PlayerCommandDeclaration.builder("attribution:open")
        .name("attribution").aliases(*aliases).executor { calls += it }.build()

    private fun map() = MockBukkit.getMock()!!.commandMap
    private fun command(label: String): Command = assertNotNull(map().getCommand(label), "/$label")

    @Test fun `a module without a folder has its commands registered from memory, under their name and the module's prefix`() {
        declare(open("source"))
        val registrar = reload()
        assertIs<PackCommand>(command("attribution"))
        assertSame(command("attribution"), command("attribution:attribution"))
        assertSame(command("attribution"), command("source"))
        registrar.unregisterAll()
        assertNull(map().getCommand("attribution"))
    }

    @Test fun `the executor gets the typed arguments the command parsed, through module_command`() {
        val target = MockBukkit.getMock()!!.addPlayer("Alex")
        val sender = MockBukkit.getMock()!!.addPlayer("Steve")
        declare(PlayerCommandDeclaration.builder("attribution:give")
            .argument(CommandArgument.player("target"))
            .argument(CommandArgument.integer("amount").optional())
            .executor { calls += it }.build())
        reload()
        command("give").execute(sender, "give", arrayOf("Alex", "3"))
        val ctx = calls.single()
        assertEquals("attribution:give", ctx.commandId)
        assertSame(target, ctx.get("target", Player::class.java))
        assertEquals(3, ctx.arguments["amount"])
        assertSame(sender, ctx.player)
    }

    @Test fun `the module's file is the command, as the admin edits it, and nothing runs from memory beside it`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val declaration = PlayerCommandDeclaration.builder("attribution:open").name("attribution").aliases("source")
            .permission("attribution.use").executor { calls += it }.build()
        declare(declaration)
        reload(project("attribution", "attribution", edited(declaration) {
            it.replace("aliases:\n  - source\n", "name: comment\naliases:\n  - how\n").replace("permission: attribution.use\n", "")
        }))
        val cmd = command("comment")
        assertSame(cmd, command("how"))
        assertSame(cmd, command("attribution:comment"))
        assertNull(map().getCommand("source"))
        assertNull(map().getCommand("attribution"))
        assertNull(cmd.permission)
        cmd.execute(player, "comment", emptyArray())
        assertEquals("attribution:open", calls.single().commandId, "module_command ran past the declared permission")
    }

    @Test fun `a disabled file registers nothing, from memory neither`() {
        val declaration = open()
        declare(declaration)
        reload(project("attribution", "attribution", edited(declaration) { "$it\nenabled: false\n" }))
        assertNull(map().getCommand("attribution"))
        assertNull(map().getCommand("attribution:attribution"))
    }

    @Test fun `children are reached by name, a root without executor prints its usage, a disabled child is gone`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val declaration = PlayerCommandDeclaration.builder("attribution:root").name("attribution")
            .child(PlayerCommandDeclaration.builder("attribution:stats").executor { calls += it }.build())
            .child(PlayerCommandDeclaration.builder("attribution:reset").executor { calls += it }.build())
            .build()
        declare(declaration)
        reload(project("attribution", "attribution", edited(declaration) {
            it.replace("  - name: reset\n", "  - name: reset\n    enabled: false\n")
        }))
        val cmd = command("attribution")
        cmd.execute(player, "attribution", arrayOf("stats"))
        assertEquals("attribution:stats", calls.single().commandId)
        cmd.execute(player, "attribution", emptyArray())
        assertEquals("usage stats", player.nextMessage())
        assertEquals(listOf("stats"), cmd.tabComplete(player, "attribution", arrayOf("")))
        cmd.execute(player, "attribution", arrayOf("reset"))
        assertEquals(1, calls.size, "a disabled child does not run")
    }

    @Test fun `the console runs a node its file opens to it, when the module allows it`() {
        val console = MockBukkit.getMock()!!.consoleSender
        declare(open())
        declare(PlayerCommandDeclaration.builder("attribution:stats").consoleAllowed(true)
            .argument(CommandArgument.integer("days").optional()).executor { calls += it }.build())
        reload()
        command("attribution").execute(console, "attribution", emptyArray())
        assertTrue(calls.isEmpty())
        command("stats").execute(console, "stats", arrayOf("7"))
        assertNull(calls.single().player)
        assertEquals(7, calls.single().arguments["days"])
    }

    @Test fun `the file's cooldown stops the second run`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val declaration = open()
        declare(declaration)
        reload(project("attribution", "attribution", edited(declaration) {
            "$it\ncooldown:\n  duration_seconds: 60\n  message: wait\n"
        }))
        command("attribution").execute(player, "attribution", emptyArray())
        command("attribution").execute(player, "attribution", emptyArray())
        assertEquals(1, calls.size)
        assertEquals("wait", player.nextMessage())
    }

    @Test fun `a failing executor is logged and the sender told, never thrown`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        declare(PlayerCommandDeclaration.builder("attribution:boom").executor { error("boom") }.build())
        reload()
        command("boom").execute(player, "boom", emptyArray())
        assertEquals("failed", player.nextMessage())
    }

    @Test fun `an admin's command keeps its name, the module's stays reachable with its prefix`() {
        val declaration = open()
        declare(declaration)
        val admin = project("test", null, "attribution" to "schema: command/v1\nactions:\n  - send_message: ok\n")
        // Listed first, the module's folder still claims after the admins'.
        val registrar = reload(project("attribution", "attribution", edited(declaration) { it }), admin)
        val player = MockBukkit.getMock()!!.addPlayer()
        command("attribution").execute(player, "attribution", emptyArray())
        assertEquals("ok", player.nextMessage())
        assertTrue(calls.isEmpty())
        command("attribution:attribution").execute(player, "attribution", emptyArray())
        assertEquals("attribution:open", calls.single().commandId)
        assertEquals("project attribution, command attribution", registrar.conflicts.single().loser)
        registrar.unregisterAll()
        assertNull(map().getCommand("attribution:attribution"))
    }

    @Test fun `two commands of one module named alike, the second is not registered`() {
        val stats = PlayerCommandDeclaration.builder("attribution:stats").executor { calls += it }.build()
        declare(open())
        declare(stats)
        val registrar = reload(project(
            "attribution", "attribution",
            edited(open()) { it },
            edited(stats) { it.replace("schema: command/v1\n", "schema: command/v1\nname: attribution\n") },
        ))
        val player = MockBukkit.getMock()!!.addPlayer()
        command("attribution:attribution").execute(player, "attribution", emptyArray())
        assertEquals("attribution:open", calls.single().commandId)
        assertEquals("project attribution, command stats", registrar.conflicts.single().loser)
    }

    @Test fun `refresh picks up a command registered after the start`() {
        val registrar = reload()
        registry.onChange(registrar::refresh)
        declare(open())
        assertIs<PackCommand>(command("attribution"))
        registry.unregister("attribution:open")
        assertNull(map().getCommand("attribution"))
    }

    @Test fun `a command calling a module command no module declares is not registered, a node of it is left out`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        reload(
            project("attribution", "attribution", "attribution" to "schema: command/v1\nactions:\n  - module_command: attribution:open\n"),
            project("test", null, "hub" to """
                |schema: command/v1
                |actions:
                |  - send_message: hub
                |subcommands:
                |  - name: shop
                |    actions:
                |      - module_command: boutique:open
                |""".trimMargin()),
        )
        assertNull(map().getCommand("attribution"), "the module is off")
        assertFalse("shop" in command("hub").tabComplete(player, "hub", arrayOf("")), "its node calling an absent module is left out")
    }

    private fun balance() = PlayerCommandDeclaration.builder("guilds:root").name("g")
        .child(PlayerCommandDeclaration.builder("guilds:balance").executor { calls += it }
            .child(PlayerCommandDeclaration.builder("guilds:balance.add").name("add")
                .argument(CommandArgument.integer("amount"))
                .permission("guilds.deposit")
                .executor { calls += it }.build())
            .build())
        .build()

    @Test fun `the file's actions replace the module's code, on a sub-command too, with its arguments`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        player.addAttachment(plugin.value, "guilds.deposit", true)
        val declaration = balance()
        declare(declaration)
        reload(project("guilds", "guilds", edited(declaration) {
            it.replace("      - module_command: guilds:balance\n", "      - send_message: menu\n")
                .replace("          - module_command: guilds:balance.add\n", "          - send_message: confirm {amount}\n")
        }))
        command("g").execute(player, "g", arrayOf("balance"))
        assertEquals("menu", player.nextMessage())
        command("g").execute(player, "g", arrayOf("balance", "add", "5"))
        assertEquals("confirm 5", player.nextMessage())
        assertTrue(calls.isEmpty(), "the module's code is not called")
    }

    @Test fun `module_command from a menu checks the permissions the file sets`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val declaration = balance()
        declare(declaration)
        reload(project("guilds", "guilds", edited(declaration) {
            it.replace("permission: guilds.deposit", "permission: vip.deposit")
        }))
        val button = ClickHandler(emptyList(), emptyList(), null, listOf(
            Step.ActionStep("module_command", mapOf("command" to "guilds:balance.add", "args" to mapOf("amount" to "7"))),
        ))
        player.addAttachment(plugin.value, "guilds.deposit", true)
        executor.value.handle(button, ExecutionContext(player))
        assertTrue(calls.isEmpty(), "the declared permission no longer opens it")
        assertEquals("no permission", player.nextMessage())

        player.addAttachment(plugin.value, "vip.deposit", true)
        executor.value.handle(button, ExecutionContext(player))
        assertEquals(7, calls.single().arguments["amount"])
    }

    private fun shop() = PlayerCommandDeclaration.builder("boutique:open")
        .name("boutique")
        .argument(CommandArgument.string("category").optional())
        .opensMenu("boutique_addon:shop_main")
        .build()

    @Test fun `a command that opens a menu opens it, its arguments as the context, and its file's actions replace it`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        declare(shop())
        reload()
        command("boutique").execute(player, "boutique", arrayOf("armes"))
        assertEquals("boutique_addon:shop_main" to mapOf<String, Any>("category" to "armes"), provider.opened.single())

        reload(project("boutique", "boutique", edited(shop()) {
            it.replace("  - open_menu: boutique_addon:shop_main\n", "  - send_message: closed\n")
        }))
        command("boutique").execute(player, "boutique", emptyArray())
        assertEquals("closed", player.nextMessage())
        assertEquals(1, provider.opened.size, "the file's actions run instead of the menu")
    }

    @Test fun `a command that opens a menu refuses the console`() {
        val console = MockBukkit.getMock()!!.consoleSender
        declare(shop())
        reload()
        command("boutique").execute(console, "boutique", emptyArray())
        assertTrue(provider.opened.isEmpty())
    }

    @Test fun `module_command opens the declared menu of a command`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        declare(shop())
        reload(project("boutique", "boutique", edited(shop()) {
            it.replace("  - open_menu: boutique_addon:shop_main\n", "  - module_command: boutique:open\n")
        }))
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

    @Test fun `an argument with suggestions completes with what the module returns, filtered by prefix`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val seen = mutableListOf<Pair<List<String>, String>>()
        declare(PlayerCommandDeclaration.builder("guilds:guild").name("guild")
            .child(PlayerCommandDeclaration.builder("guilds:join")
                .argument(CommandArgument.string("guild").suggestions { ctx ->
                    seen += ctx.previousArguments to ctx.input
                    listOf("Alpha", "alpine", "Beta", "Alpha")
                })
                .argument(CommandArgument.player("target").optional())
                .executor { calls += it }.build())
            .build())
        reload()
        val cmd = command("guild")

        assertEquals(listOf("Alpha", "alpine"), cmd.tabComplete(player, "guild", arrayOf("join", "al")))
        assertEquals(emptyList<String>() to "al", seen.single())
        assertEquals(listOf(player.name), cmd.tabComplete(player, "guild", arrayOf("join", "Alpha", "")), "no provider: Artisan's own completion")
        cmd.execute(player, "guild", arrayOf("join", "Gamma"))
        assertEquals("Gamma", calls.single().arguments["guild"], "parsing is unchanged")
    }

    @Test fun `a failing provider offers nothing`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        declare(PlayerCommandDeclaration.builder("guilds:info").name("ginfo")
            .argument(CommandArgument.string("guild").suggestions { error("boom") })
            .executor { calls += it }.build())
        reload()
        assertEquals(emptyList(), command("ginfo").tabComplete(player, "ginfo", arrayOf("")))
    }

    @Test fun `a choice keeps its fixed values`() {
        assertFailsWith<IllegalStateException> { CommandArgument.choice("mode", listOf("a")).suggestions { listOf("b") } }
        val provider = net.artisanmc.modules.api.playercommand.SuggestionProvider { emptyList() }
        assertSame(provider, CommandArgument.string("x").suggestions(provider).optional().suggestions)
    }
}
