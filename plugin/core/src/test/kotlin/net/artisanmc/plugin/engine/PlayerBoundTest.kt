package net.artisanmc.plugin.engine

import kotlin.test.Test
import kotlin.test.assertEquals

/** Which conditions read a player, for `testWithoutPlayer`. */
class PlayerBoundTest {
    private fun reasons(raw: Any) = PlayerBound.reasons(KeyedStepParser.parseConditionStrict(raw)!!)

    @Test fun `expressions on args, has_var, random_chance and pagination need no player`() {
        assertEquals(emptyList(), reasons(mapOf("expression" to "guild_level >= 2 && var.rpg.season == 'winter'")))
        assertEquals(emptyList(), reasons(mapOf("has_var" to "rpg/event_open")))
        assertEquals(emptyList(), reasons(mapOf("random_chance" to 0.5)))
        assertEquals(emptyList(), reasons(mapOf("pagination_at_first" to "")))
        assertEquals(emptyList(), reasons(mapOf("and" to listOf(mapOf("expression" to "a"), mapOf("not" to mapOf("expression" to "b"))))))
    }

    @Test fun `every condition on the player, their world or their client is player-bound`() {
        val bound = mapOf(
            "has_permission" to "vip.use", "has_money" to 10, "has_item" to mapOf("material" to "stone"),
            "has_xp" to 5, "has_level" to 5, "placeholder_equals" to mapOf("placeholder" to "%x%", "value" to "1"),
            "placeholder_match" to mapOf("placeholder" to "%x%", "regex" to "1"), "cooldown_passed" to "c",
            "world_is" to "world", "client_is" to "java", "has_resource_pack" to true, "time_is" to "day",
            "player_in_region" to "spawn",
        )
        for ((name, value) in bound) assertEquals(listOf(name), reasons(mapOf(name to value)), name)
    }

    @Test fun `an expression reading a placeholder or the player is player-bound`() {
        assertEquals(listOf("expression placeholder %vault_eco_balance%"), reasons(mapOf("expression" to "%vault_eco_balance% >= 10")))
        assertEquals(listOf("expression name 'player'"), reasons(mapOf("expression" to "player.name == 'Iban'")))
        assertEquals(emptyList(), reasons(mapOf("expression" to "guild.player_count >= 3")), "a field named player is not the root")
    }

    @Test fun `a nested player-bound operand is reported, even under not and or`() {
        assertEquals(listOf("has_permission"), reasons(mapOf("not" to mapOf("has_permission" to "x"))))
        assertEquals(
            listOf("has_level", "world_is"),
            reasons(mapOf("or" to listOf(mapOf("expression" to "a"), mapOf("has_level" to 1), mapOf("world_is" to "w"), mapOf("has_level" to 2)))),
        )
    }
}
