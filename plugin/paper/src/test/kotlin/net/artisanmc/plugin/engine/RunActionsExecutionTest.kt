package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.entity.Player
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Executes `run_actions` end-to-end (ADR action-dsl): self-binding of
 * the bound row, the depth guard, and tolerant no-op failure modes.
 */
class RunActionsExecutionTest {

    private val plain = PlainTextComponentSerializer.plainText()

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<ProjectBundle> = emptyList()
    }

    private fun executor() =
        ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns, evaluator, null)

    private fun drain(player: be.seeseemelk.mockbukkit.entity.PlayerMock): List<String> {
        val out = mutableListOf<String>()
        while (true) {
            val next = player.nextComponentMessage() ?: break
            out += plain.serialize(next)
        }
        return out
    }

    @Test fun `bound row fields resolve bare inside the called chain`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val row = mapOf("price" to 100, "on_buy" to "send_message \"paid {price}\"")
        val ctx = ExecutionContext(p, args = mapOf("item" to row))
        executor().execute(listOf(Step.ActionStep("run_actions", "item.on_buy")), ctx)
        assertEquals(listOf("paid 100"), drain(p))
    }

    @Test fun `self prefix addresses the bound row explicitly`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val row = mapOf("price" to 42, "on_buy" to "send_message \"cost {self.price}\"")
        val ctx = ExecutionContext(p, args = mapOf("item" to row))
        executor().execute(listOf(Step.ActionStep("run_actions", "item.on_buy")), ctx)
        assertEquals(listOf("cost 42"), drain(p))
    }

    @Test fun `self-referential chain stops at the depth guard without overflow`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val row = mapOf("on_buy" to "run_actions item.on_buy")
        val ctx = ExecutionContext(p, args = mapOf("item" to row))
        // Must terminate at depth 16 — no StackOverflowError, no throw.
        executor().execute(listOf(Step.ActionStep("run_actions", "item.on_buy")), ctx)
        assertTrue(drain(p).isEmpty())
    }

    @Test fun `missing value is a tolerant no-op`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val ctx = ExecutionContext(p, args = mapOf("item" to mapOf("price" to 1)))
        executor().execute(listOf(Step.ActionStep("run_actions", "item.absent")), ctx)
        assertNull(p.nextComponentMessage())
    }

    @Test fun `blank value is a tolerant no-op`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val ctx = ExecutionContext(p, args = mapOf("item" to mapOf("on_buy" to "   ")))
        executor().execute(listOf(Step.ActionStep("run_actions", "item.on_buy")), ctx)
        assertNull(p.nextComponentMessage())
    }

    @Test fun `unparseable value is a tolerant no-op`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val ctx = ExecutionContext(p, args = mapOf("item" to mapOf("on_buy" to "not_a_verb foo bar")))
        executor().execute(listOf(Step.ActionStep("run_actions", "item.on_buy")), ctx)
        assertNull(p.nextComponentMessage())
    }
}
