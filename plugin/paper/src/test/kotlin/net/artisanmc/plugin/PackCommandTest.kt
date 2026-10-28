package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.*
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.engine.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*
import net.artisanmc.plugin.integrations.SoftDepRegistry

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
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }
    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)

    private fun cmd(name: String, argDefs: List<ArgDef> = emptyList(), handler: ClickHandler = ClickHandler(emptyList(), emptyList()), permission: String? = null): PackCommand {
        val compiled = CompiledCommand(name, emptyList(), permission, null, argDefs, handler)
        return PackCommand(compiled, executor(), lang)
    }

    @Test fun `a command resolves its menu references in its own project`() {
        var openedFrom: String? = "unset"
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String): RuntimeMenu? = null
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                openedFrom = ctx.projectId
            }
        }
        val handler = ClickHandler(emptyList(), emptyList(), steps = listOf(Step.ActionStep("open_menu", "main")))
        val compiled = CompiledCommand("shopcmd", emptyList(), null, null, emptyList(), handler)
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
                override fun findMenu(menuId: String): RuntimeMenu? = null
                override fun runtimeProjects(): List<RuntimeProject> = emptyList()
                override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                    assertEquals("menu_zdzd", menuId)
                    opened = lang to ctx
                }
            }
            val actions = ActionExecutor(plugin.value, provider, sessions, deps, cooldowns, evaluator)
            val handler = ClickHandler(emptyList(), emptyList(), steps = listOf(Step.ActionStep("open_menu", "menu_zdzd")))
            val command = PackCommand(CompiledCommand("testimg", emptyList(), null, null, emptyList(), handler), actions, languages)
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

    private fun sends(text: String) = ClickHandler(emptyList(), emptyList(), steps = listOf(Step.ActionStep("send_message", text)))

    private fun tree() = PackCommand(
        CompiledCommand(
            "ah", emptyList(), null, null, emptyList(), sends("root"),
            children = listOf(
                CompiledCommand("sell", listOf("s"), null, null, listOf(ArgDef.IntArg("price")), sends("sold {price}")),
                CompiledCommand(
                    "admin", emptyList(), "ah.admin", null, emptyList(), ClickHandler(emptyList(), emptyList()),
                    children = listOf(CompiledCommand("reindex", emptyList(), null, null, emptyList(), sends("reindexed"))),
                ),
            ),
        ),
        executor(), lang,
    )

    @Test fun `a sub-command runs its own chain with its own arguments`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        tree().execute(player, "ah", arrayOf("s", "12"))
        assertEquals("sold 12", player.nextComponentMessage()?.let(::plain))
    }

    @Test fun `the root runs when no sub-command is typed`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        tree().execute(player, "ah", emptyArray())
        assertEquals("root", player.nextComponentMessage()?.let(::plain))
    }

    @Test fun `a sub-command's permission adds to its parent's`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        tree().execute(player, "ah", arrayOf("admin", "reindex"))
        assertNotEquals("reindexed", player.nextComponentMessage()?.let(::plain))
        player.addAttachment(plugin.value, "ah.admin", true)
        tree().execute(player, "ah", arrayOf("admin", "reindex"))
        assertEquals("reindexed", player.nextComponentMessage()?.let(::plain))
    }

    @Test fun `a node without actions shows the usage of its sub-commands`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        player.addAttachment(plugin.value, "ah.admin", true)
        val usage = LangManager(mapOf("en" to mapOf("cmd.usage" to "Usage: /{command} ({subcommands})")), "en", false)
        PackCommand(
            CompiledCommand(
                "ah", emptyList(), null, null, emptyList(), ClickHandler(emptyList(), emptyList()),
                children = listOf(CompiledCommand("admin", emptyList(), null, null, emptyList(), ClickHandler(emptyList(), emptyList()),
                    children = listOf(CompiledCommand("reindex", emptyList(), null, null, emptyList(), sends("reindexed"))))),
            ),
            executor(), usage,
        ).execute(player, "ah", arrayOf("admin"))
        assertEquals("Usage: /ah admin (reindex)", player.nextComponentMessage()?.let(::plain))
    }

    @Test fun `completion offers the sub-commands the sender may run, then the node's arguments`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        assertEquals(listOf("sell"), tree().tabComplete(player, "ah", arrayOf("")))
        player.addAttachment(plugin.value, "ah.admin", true)
        assertEquals(listOf("sell", "admin"), tree().tabComplete(player, "ah", arrayOf("")))
        assertEquals(listOf("reindex"), tree().tabComplete(player, "ah", arrayOf("admin", "re")))
    }

    private fun plain(c: net.kyori.adventure.text.Component) =
        net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(c)
}
