package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.ConditionParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class ConditionParserTest {

    @Test fun `parse has_permission`() {
        assertEquals(Condition.HasPermission("admin.use"),
            ConditionParser.parse(mapOf("type" to "has_permission", "perm" to "admin.use")))
    }

    @Test fun `parse has_money`() {
        assertEquals(Condition.HasMoney(100.0),
            ConditionParser.parse(mapOf("type" to "has_money", "amount" to 100.0)))
    }

    @Test fun `parse has_money with currency`() {
        assertEquals(Condition.HasMoney(50.0, "tokens"),
            ConditionParser.parse(mapOf("type" to "has_money", "amount" to 50.0, "currency" to "tokens")))
    }

    @Test fun `parse has_item`() {
        assertEquals(Condition.HasItem("DIAMOND", 3),
            ConditionParser.parse(mapOf("type" to "has_item", "material" to "DIAMOND", "count" to 3)))
    }

    @Test fun `parse has_xp`() {
        assertEquals(Condition.HasXp(500),
            ConditionParser.parse(mapOf("type" to "has_xp", "amount" to 500)))
    }

    @Test fun `parse has_level`() {
        assertEquals(Condition.HasLevel(10),
            ConditionParser.parse(mapOf("type" to "has_level", "level" to 10)))
    }

    @Test fun `parse placeholder_equals`() {
        assertEquals(Condition.PlaceholderEquals("%player_name%", "Steve"),
            ConditionParser.parse(mapOf("type" to "placeholder_equals", "placeholder" to "%player_name%", "value" to "Steve")))
    }

    @Test fun `parse placeholder_match`() {
        assertEquals(Condition.PlaceholderMatch("%rank%", "VIP.*"),
            ConditionParser.parse(mapOf("type" to "placeholder_match", "placeholder" to "%rank%", "regex" to "VIP.*")))
    }

    @Test fun `parse cooldown_passed`() {
        assertEquals(Condition.CooldownPassed("daily_reward"),
            ConditionParser.parse(mapOf("type" to "cooldown_passed", "cooldown_id" to "daily_reward")))
    }

    @Test fun `parse world_is`() {
        assertEquals(Condition.WorldIs("nether"),
            ConditionParser.parse(mapOf("type" to "world_is", "world" to "nether")))
    }

    @Test fun `parse time_is with object range normalizes to from-to string`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "time_is",
            "range" to mapOf("from_ticks" to 1000, "to_ticks" to 5000),
        )) as Condition.TimeIs
        assertEquals("1000-5000", c.range)
    }

    @Test fun `parse time_is`() {
        assertEquals(Condition.TimeIs("day"),
            ConditionParser.parse(mapOf("type" to "time_is", "range" to "day")))
    }

    @Test fun `parse random_chance`() {
        assertEquals(Condition.RandomChance(0.75),
            ConditionParser.parse(mapOf("type" to "random_chance", "probability" to 0.75)))
    }

    @Test fun `parse player_in_region`() {
        assertEquals(Condition.PlayerInRegion("spawn"),
            ConditionParser.parse(mapOf("type" to "player_in_region", "region" to "spawn")))
    }

    @Test fun `parse pagination_at_first`() {
        assertIs<Condition.PaginationAtFirst>(ConditionParser.parse(mapOf("type" to "pagination_at_first")))
    }

    @Test fun `parse not wraps inner condition`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "not",
            "of"   to mapOf("type" to "has_permission", "perm" to "foo"),
        ))
        assertEquals(Condition.Not(Condition.HasPermission("foo")), c)
    }

    @Test fun `parse and combines list`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "and",
            "of"   to listOf(
                mapOf("type" to "has_level", "level" to 5),
                mapOf("type" to "has_xp",    "amount" to 100),
            ),
        ))
        assertEquals(Condition.And(listOf(Condition.HasLevel(5), Condition.HasXp(100))), c)
    }

    @Test fun `parse or combines list`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "or",
            "of"   to listOf(mapOf("type" to "world_is", "world" to "end")),
        ))
        assertEquals(Condition.Or(listOf(Condition.WorldIs("end"))), c)
    }

    @Test fun `unknown type throws`() {
        assertFailsWith<IllegalArgumentException> {
            ConditionParser.parse(mapOf("type" to "fly_to_moon"))
        }
    }
}
