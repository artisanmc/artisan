package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.command.CommandDeclaration
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.plugin.ArtisanPlugin
import org.bukkit.entity.Player
import kotlin.test.*
import net.artisanmc.plugin.integrations.SoftDepRegistry

class RunCommandBridgeTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): RuntimeMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
        override fun runtimeProjects(): List<RuntimeProject> = emptyList()
    }

    private fun makeExecutor(commandRegistry: CommandRegistry?) =
        ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns, evaluator, commandRegistry)

    private fun registryWith(name: String, onCall: (Player, Map<String, Any?>) -> Unit) =
        CommandRegistry().apply { register(CommandDeclaration(name, onCall)) }

    @Test fun `namespaced command known to the registry dispatches with argv and raw`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        var seen: Map<String, Any?>? = null
        val registry = registryWith("boutique:buy") { _, args -> seen = args }
        val executor = makeExecutor(commandRegistry = registry)
        executor.execute(listOf(Step.ActionStep("run_command", "boutique:buy sword extra")), ExecutionContext(p))
        assertEquals(listOf("sword", "extra"), seen?.get("argv"))
        assertEquals("sword extra", seen?.get("raw"))
    }

    @Test fun `quoted arguments and a differently cased ref reach the handler`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        var seen: Map<String, Any?>? = null
        val registry = registryWith("boutique:buy") { _, args -> seen = args }
        val executor = makeExecutor(commandRegistry = registry)
        executor.execute(listOf(Step.ActionStep("run_command", "Boutique:Buy \"Diamond Sword\" 2")), ExecutionContext(p))
        assertEquals(listOf("Diamond Sword", "2"), seen?.get("argv"))
        assertEquals("\"Diamond Sword\" 2", seen?.get("raw"))
    }

    @Test fun `namespaced command unknown to the registry falls back to Bukkit`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val executor = makeExecutor(commandRegistry = CommandRegistry())
        // Must not throw UnknownCommandException: performCommand is the fallback.
        executor.execute(listOf(Step.ActionStep("run_command", "essentials:home base")), ExecutionContext(p))
    }

    @Test fun `null registry keeps legacy behavior`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val executor = makeExecutor(commandRegistry = null)
        executor.execute(listOf(Step.ActionStep("run_command", "boutique:buy sword")), ExecutionContext(p))
    }

    @Test fun `console run_command never routes to the registry`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        var called = false
        val registry = registryWith("boutique:buy") { _, _ -> called = true }
        val executor = makeExecutor(commandRegistry = registry)
        executor.execute(listOf(Step.ActionStep("run_command", mapOf("command" to "boutique:buy sword", "as" to "console"))), ExecutionContext(p))
        assertFalse(called)
    }
}
