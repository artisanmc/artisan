package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.entity.PlayerMock
import net.artisanmc.modules.api.variable.ModuleVariableDeclaration
import net.artisanmc.modules.api.variable.VariableRegistry
import net.artisanmc.modules.api.variable.VariableScope
import net.artisanmc.modules.api.variable.VariableType
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.kyori.adventure.text.event.ClickEvent
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.entity.Player
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * ADR `triggers-and-variables` end to end in the engine: Project variables written by `set_var`,
 * `add_var`, `clear_var` and read by `{var.…}` and `has_var`; typed arguments resolved by template
 * (§6) with `teleport` to a stored place; `chat_button` (§7).
 */
class VariablesExecutionTest {
    private val plain = PlainTextComponentSerializer.plainText()
    private lateinit var variables: ProjectVariables
    private val changes = mutableListOf<String>()

    @BeforeTest fun setup() {
        MockBukkit.mock()
        pluginInstance
        variables = ProjectVariables(VariableStore())
        variables.definitions = listOf(
            ProjectVariable("rpg", "last_death", VariableScope.PLAYER, VariableType.LOCATION, null, 0),
            ProjectVariable("rpg", "coins", VariableScope.PLAYER, VariableType.NUMBER, 10.0, 0),
            ProjectVariable("rpg", "season", VariableScope.SERVER, VariableType.STRING, null, 0),
            ProjectVariable("rpg", "vip", VariableScope.PLAYER, VariableType.BOOLEAN, null, 0),
        ).associateBy { it.ref }
        variables.onChange = { _, v -> changes += v.id }
        ModuleVariableValues.projects = variables
        ModuleVariableValues.registry = VariableRegistry().apply {
            bindOwner("guilds")
            declare(ModuleVariableDeclaration("rank", VariableType.STRING, VariableScope.PLAYER) { _, _ -> "officer" })
            bindOwner(null)
        }
        ChatButtons.clear()
    }

    @AfterTest fun teardown() {
        ModuleVariableValues.projects = null
        ModuleVariableValues.registry = null
        ChatButtons.executor = null
        MockBukkit.unmock()
    }

    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val evaluator = ConditionEvaluator(deps, CooldownStore())
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }
    /** What `teleport` received: MockBukkit does not move a player on `teleportAsync`. */
    private val teleports = mutableListOf<Map<String, Any>>()
    private val registry = net.artisanmc.modules.api.action.ActionRegistry().apply {
        CoreActionHandlers.declarations().filter { it.name != "teleport" }.forEach(::register)
        register(CoreActions.TELEPORT.declare { ctx, args, _ -> teleports += args; ctx })
    }
    private val executor by lazy {
        ActionExecutor(pluginInstance, stubProvider, MenuSessionStore(), deps, CooldownStore(), evaluator, null, registry = registry)
    }

    private fun run(p: Player, vararg steps: Pair<String, Any?>) =
        executor.execute(steps.map { (name, value) -> Step.ActionStep(name, value) }, ExecutionContext(p, projectId = "rpg"))

    private fun messages(p: PlayerMock): List<String> = generateSequence { p.nextComponentMessage() }.map(plain::serialize).toList()

    private fun holds(c: Condition, p: Player) = evaluator.evaluate(c, ExecutionContext(p, projectId = "rpg"))

    @Test fun `set, add and clear write the project's Variables, texts and has_var read them`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        assertFalse(holds(Condition.HasVar("coins"), p), "the default is not a stored value")
        run(p,
            "send_message" to "coins {var.coins}",
            "add_var" to mapOf("var" to "coins", "amount" to 5),
            "set_var" to mapOf("var" to "season", "value" to "winter of {player}"),
            "set_var" to mapOf("var" to "vip", "value" to "true"),
            "send_message" to "coins {var.coins}, {var.season}, rank {var.guilds.rank}",
        )
        assertEquals(listOf("coins 10", "coins 15, winter of ${p.name}, rank officer"), messages(p))
        assertTrue(holds(Condition.HasVar("coins"), p))
        assertTrue(holds(Condition.Expression("var.vip"), p), "a boolean Variable is a condition by itself")
        assertTrue(holds(Condition.HasVar("guilds.rank"), p))
        assertFalse(holds(Condition.HasVar("guilds.missing"), p))
        assertEquals(listOf("coins", "season", "vip"), changes)

        run(p, "clear_var" to "coins")
        assertFalse(holds(Condition.HasVar("coins"), p))
        assertTrue(holds(Condition.Expression("var.coins == 10"), p), "back to its default")
    }

    @Test fun `server Variables are shared, player ones are not`() {
        val a = MockBukkit.getMock()!!.addPlayer()
        val b = MockBukkit.getMock()!!.addPlayer()
        run(a, "set_var" to mapOf("var" to "season", "value" to "summer"), "add_var" to "coins")
        assertTrue(holds(Condition.Expression("var.season == \"summer\""), b))
        assertTrue(holds(Condition.Expression("var.coins == 10"), b))
        assertTrue(holds(Condition.Expression("var.coins == 11"), a))
    }

    @Test fun `a value of another type, an unknown name or a module Variable is never written`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        run(p,
            "set_var" to mapOf("var" to "coins", "value" to "lots"),
            "set_var" to mapOf("var" to "nope", "value" to "1"),
            "set_var" to mapOf("var" to "guilds.rank", "value" to "leader"),
            "add_var" to "season",
        )
        assertFalse(holds(Condition.HasVar("coins"), p))
        assertFalse(holds(Condition.HasVar("season"), p))
        assertTrue(changes.isEmpty())
    }

    @Test fun `a place is stored from the context and teleport reads it back`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val world = p.world.name
        executor.execute(
            listOf(Step.ActionStep("set_var", mapOf("var" to "last_death", "value" to "{death}"))),
            ExecutionContext(p, args = mapOf("death" to LocationValue(world, 10.0, 70.0, -4.0)), projectId = "rpg"),
        )
        run(p, "send_message" to "died at {var.last_death}", "teleport" to "{var.last_death}")
        assertEquals(listOf("died at $world 10 70 -4"), messages(p))
        assertEquals(listOf(mapOf<String, Any>("location" to LocationValue(world, 10.0, 70.0, -4.0))), teleports)
    }

    @Test fun `a typed argument that does not resolve skips the action instead of using 0`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        run(p, "teleport" to mapOf("world" to p.world.name, "x" to "{var.nothing}", "y" to 5, "z" to 5))
        run(p, "teleport" to "{var.last_death}")
        assertTrue(teleports.isEmpty())
        run(p, "teleport" to mapOf("world" to p.world.name, "x" to "{var.coins}", "y" to 5, "z" to 5))
        assertEquals(10.0, teleports.single()["x"], "a template that resolves is converted before the handler")
    }

    @Test fun `a chat button runs its chain once, for its player only, with the bindings it was sent with`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val other = MockBukkit.getMock()!!.addPlayer()
        ChatButtons.executor = executor
        executor.execute(
            listOf(Step.ActionStep("chat_button", mapOf(
                "text" to "Died at {spot}.",
                "label" to "[Go back]",
                "do" to listOf(mapOf("send_message" to "back to {spot}"), mapOf("add_var" to "coins")),
            ))),
            ExecutionContext(p, args = mapOf("spot" to "the bridge"), projectId = "rpg"),
        )
        val line = assertNotNull(p.nextComponentMessage())
        assertEquals("Died at the bridge. [Go back]", plain.serialize(line))
        val click = line.children().last().clickEvent()
        assertNotNull(click)
        assertEquals(ClickEvent.Action.RUN_COMMAND, click.action())
        val token = click.value().removePrefix(ChatButtons.COMMAND)

        assertFalse(ChatButtons.click(other, token), "another player's button")
        assertTrue(ChatButtons.click(p, token))
        assertFalse(ChatButtons.click(p, token), "used up")
        assertEquals(listOf("back to the bridge"), messages(p))
        assertTrue(holds(Condition.Expression("var.coins == 11"), p))
        assertNull(other.nextComponentMessage())
    }

    @Test fun `an expired chat button does nothing`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        var now = 0L
        ChatButtons.clock = { now }
        try {
            val token = ChatButtons.issue(ExecutionContext(p, projectId = "rpg"), listOf(mapOf("add_var" to "coins")), uses = 3, seconds = 60)
            ChatButtons.executor = executor
            now = 61_000
            assertFalse(ChatButtons.click(p, token))
        } finally {
            ChatButtons.clock = System::currentTimeMillis
        }
    }

    @Test fun `player location is a place set_var stores`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val at = p.location
        run(p, "set_var" to mapOf("var" to "last_death", "value" to "{player.location}"), "teleport" to "{var.last_death}")
        val expected = LocationValue(at.world.name, at.x, at.y, at.z, at.yaw.toDouble(), at.pitch.toDouble())
        assertEquals(listOf(mapOf<String, Any>("location" to expected)), teleports)
    }

    @Test fun `player vanished reads the vanish plugins' metadata`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        assertFalse(holds(Condition.Expression("player.vanished"), p))
        p.setMetadata("vanished", org.bukkit.metadata.FixedMetadataValue(pluginInstance, true))
        assertTrue(holds(Condition.Expression("player.vanished"), p))
        assertFalse(holds(Condition.Expression("!player.vanished"), p))
    }
}
