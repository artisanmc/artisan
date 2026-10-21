package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.CurrencyProvider
import net.artisanmc.modules.api.DuplicateCurrencyException
import net.artisanmc.modules.api.EconomyRegistry
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.OfflinePlayer
import org.bukkit.entity.Player
import java.math.BigDecimal
import java.util.UUID
import kotlin.test.*

/** `give_money` / `take_money` / `has_money` go through the currency named by the step. */
class EconomyActionsTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private class Wallet(override val id: String) : CurrencyProvider {
        val balances = HashMap<UUID, BigDecimal>()
        override fun balance(player: OfflinePlayer) = balances[player.uniqueId] ?: BigDecimal.ZERO
        override fun withdraw(player: OfflinePlayer, amount: BigDecimal): Boolean {
            val now = balance(player)
            if (now < amount) return false
            balances[player.uniqueId] = now - amount
            return true
        }
        override fun deposit(player: OfflinePlayer, amount: BigDecimal): Boolean {
            balances[player.uniqueId] = balance(player) + amount
            return true
        }
    }

    private val vault = Wallet("vault")
    private val tokens = Wallet("tokens")
    private val economy = EconomyRegistry().apply { register(vault); register(tokens) }
    private val deps = SoftDepRegistry(
        economy = economy, papi = null, worldGuard = null,
        nexoItems = null, oraxenItems = null, itemsAdderItems = null,
    )
    private val cooldowns = CooldownStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val noMenus = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<ProjectBundle> = emptyList()
    }

    private fun executor() = ActionExecutor(pluginInstance, noMenus, MenuSessionStore(), deps, cooldowns, evaluator)
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun run(p: Player, vararg actions: Action) =
        executor().handle(ClickHandler(emptyList(), actions.toList(), emptyList()), ExecutionContext(p))

    @Test fun `take_money with a currency debits that currency only`() {
        val p = player()
        vault.balances[p.uniqueId] = BigDecimal("100")
        tokens.balances[p.uniqueId] = BigDecimal("100")
        run(p, Action.TakeMoney(30.0, "tokens"))
        assertEquals(0, BigDecimal("70").compareTo(tokens.balance(p)))
        assertEquals(0, BigDecimal("100").compareTo(vault.balance(p)))
    }

    @Test fun `take_money without currency debits the default currency`() {
        val p = player()
        vault.balances[p.uniqueId] = BigDecimal("100")
        run(p, Action.TakeMoney(30.0))
        assertEquals(0, BigDecimal("70").compareTo(vault.balance(p)))
    }

    @Test fun `an unknown currency is never replaced by the default one`() {
        val p = player()
        vault.balances[p.uniqueId] = BigDecimal("100")
        run(p, Action.TakeMoney(30.0, "gems"), Action.GiveMoney(30.0, "gems"))
        assertEquals(0, BigDecimal("100").compareTo(vault.balance(p)))
        assertFalse(evaluator.evaluate(Condition.HasMoney(1.0, "gems"), ExecutionContext(p)))
    }

    @Test fun `give_money credits the named currency`() {
        val p = player()
        run(p, Action.GiveMoney(12.5, "tokens"))
        assertEquals(0, BigDecimal("12.5").compareTo(tokens.balance(p)))
    }

    @Test fun `has_money reads the named currency`() {
        val p = player()
        vault.balances[p.uniqueId] = BigDecimal("5")
        tokens.balances[p.uniqueId] = BigDecimal("500")
        assertTrue(evaluator.evaluate(Condition.HasMoney(100.0, "tokens"), ExecutionContext(p)))
        assertFalse(evaluator.evaluate(Condition.HasMoney(100.0), ExecutionContext(p)))
    }

    @Test fun `a currency id is registered once`() {
        assertFailsWith<DuplicateCurrencyException> { economy.register(Wallet("tokens")) }
    }
}
