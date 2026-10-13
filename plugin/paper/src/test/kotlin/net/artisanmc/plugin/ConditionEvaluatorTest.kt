package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.*
import kotlin.test.*

class ConditionEvaluatorTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val eval = ConditionEvaluator(SoftDepRegistry.EMPTY, CooldownStore())
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun ctx(p: org.bukkit.entity.Player) = ExecutionContext(p)

    @Test fun `has_permission true when player has it`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "admin.use", true)
        assertTrue(eval.evaluate(Condition.HasPermission("admin.use"), ctx(p)))
    }

    @Test fun `has_permission false when player lacks it`() {
        assertFalse(eval.evaluate(Condition.HasPermission("admin.use"), ctx(player())))
    }

    @Test fun `not inverts true to false`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "foo", true)
        assertFalse(eval.evaluate(Condition.Not(Condition.HasPermission("foo")), ctx(p)))
    }

    @Test fun `not inverts false to true`() {
        assertTrue(eval.evaluate(Condition.Not(Condition.HasPermission("foo")), ctx(player())))
    }

    @Test fun `and returns false if any fail`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "a", true)
        val cond = Condition.And(listOf(Condition.HasPermission("a"), Condition.HasPermission("b")))
        assertFalse(eval.evaluate(cond, ctx(p)))
    }

    @Test fun `and returns true when all pass`() {
        val p = player()
        val plugin = MockBukkit.createMockPlugin()
        p.addAttachment(plugin, "a", true)
        p.addAttachment(plugin, "b", true)
        assertTrue(eval.evaluate(Condition.And(listOf(Condition.HasPermission("a"), Condition.HasPermission("b"))), ctx(p)))
    }

    @Test fun `or returns true if any pass`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "a", true)
        assertTrue(eval.evaluate(Condition.Or(listOf(Condition.HasPermission("a"), Condition.HasPermission("b"))), ctx(p)))
    }

    @Test fun `or returns false if none pass`() {
        assertFalse(eval.evaluate(Condition.Or(listOf(Condition.HasPermission("x"), Condition.HasPermission("y"))), ctx(player())))
    }

    @Test fun `has_level true when player level matches`() {
        val p = player()
        p.level = 10
        assertTrue(eval.evaluate(Condition.HasLevel(10), ctx(p)))
        assertFalse(eval.evaluate(Condition.HasLevel(11), ctx(p)))
    }

    @Test fun `has_xp true when player xp matches`() {
        val p = player()
        p.totalExperience = 500
        assertTrue(eval.evaluate(Condition.HasXp(500), ctx(p)))
        assertFalse(eval.evaluate(Condition.HasXp(501), ctx(p)))
    }

    @Test fun `has_item false when inventory empty`() {
        assertFalse(eval.evaluate(Condition.HasItem("DIAMOND", 1), ctx(player())))
    }

    @Test fun `random_chance probability 1 always true`() {
        assertTrue(eval.evaluate(Condition.RandomChance(1.0), ctx(player())))
    }

    @Test fun `random_chance probability 0 always false`() {
        assertFalse(eval.evaluate(Condition.RandomChance(0.0), ctx(player())))
    }

    @Test fun `cooldown_passed true when no cooldown set`() {
        assertTrue(eval.evaluate(Condition.CooldownPassed("daily"), ctx(player())))
    }

    @Test fun `cooldown_passed false when cooldown active`() {
        val cooldowns = CooldownStore()
        val e = ConditionEvaluator(SoftDepRegistry.EMPTY, cooldowns)
        val p = player()
        cooldowns.set("daily", p.uniqueId, "player", 3600)
        assertFalse(e.evaluate(Condition.CooldownPassed("daily"), ctx(p)))
    }

    @Test fun `has_money returns false when vault absent`() {
        assertFalse(eval.evaluate(Condition.HasMoney(100.0), ctx(player())))
    }

    @Test fun `player_in_region returns false when worldguard absent`() {
        assertFalse(eval.evaluate(Condition.PlayerInRegion("spawn"), ctx(player())))
    }

    @Test fun `placeholder_equals returns false when papi absent`() {
        assertFalse(eval.evaluate(Condition.PlaceholderEquals("%player_name%", "Steve"), ctx(player())))
    }

    @Test fun `pagination_at_first true on page 0, false after`() {
        val p = player()
        val first = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(0, 3)))
        val mid   = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(1, 3)))
        assertTrue(eval.evaluate(Condition.PaginationAtFirst("grid"), first))
        assertFalse(eval.evaluate(Condition.PaginationAtFirst("grid"), mid))
    }

    @Test fun `pagination_at_last true on the final page`() {
        val p = player()
        val last = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(2, 3)))
        assertTrue(eval.evaluate(Condition.PaginationAtLast("grid"), last))
    }

    @Test fun `element_id omitted targets the single iterating element`() {
        val p = player()
        val one = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(0, 2)))
        assertTrue(eval.evaluate(Condition.PaginationAtFirst(null), one))
    }

    @Test fun `no iterating element — at_first and at_last are both true (hide both pagers)`() {
        val p = player()
        val none = ExecutionContext(p)
        assertTrue(eval.evaluate(Condition.PaginationAtFirst(null), none))
        assertTrue(eval.evaluate(Condition.PaginationAtLast(null), none))
    }

    @Test fun `world_is true when player is in matching world`() {
        val p = player()
        assertTrue(eval.evaluate(Condition.WorldIs(p.world.name), ctx(p)))
    }

    @Test fun `evaluateAll returns true for empty list`() {
        assertTrue(eval.evaluateAll(emptyList<Condition>(), ctx(player())))
    }

    // expression (leaf evaluator, ADR action-dsl §6)

    @Test fun `expression numeric comparison against resolved args`() {
        val p = player()
        val c = ExecutionContext(p, args = mapOf("balance" to 150))
        assertTrue(eval.evaluate(Condition.Expression("balance >= 100"), c))
        assertFalse(eval.evaluate(Condition.Expression("balance >= 200"), c))
    }

    @Test fun `expression arithmetic then compare`() {
        val p = player()
        val c = ExecutionContext(p, args = mapOf("gold" to 300, "silver" to 250))
        assertTrue(eval.evaluate(Condition.Expression("gold + silver > 500"), c))
    }

    @Test fun `expression bare truthy over nested path`() {
        val p = player()
        val c = ExecutionContext(p, args = mapOf("item" to mapOf("vip" to true)))
        assertTrue(eval.evaluate(Condition.Expression("item.vip"), c))
    }

    @Test fun `expression missing path is false`() {
        assertFalse(eval.evaluate(Condition.Expression("is_vip"), ctx(player())))
    }

    @Test fun `expression unparseable is false`() {
        assertFalse(eval.evaluate(Condition.Expression("balance >< 5"), ctx(player())))
    }
}
