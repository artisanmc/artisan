package net.artisanmc.plugin.engine

import kotlin.test.*

/** `KeyedStepParser.parseConditionStrict`: what `api.getConditions()` reads, failing closed. */
class StrictConditionParserTest {

    private fun strict(raw: Any?) = KeyedStepParser.parseConditionStrict(raw)

    @Test fun `reads the keyed and the type-tagged forms`() {
        assertEquals(Condition.HasPermission("vip.use"), strict(mapOf("has_permission" to "vip.use")))
        assertEquals(Condition.HasPermission("vip.use"), strict(mapOf("type" to "has_permission", "perm" to "vip.use")))
        assertEquals(
            Condition.PlaceholderEquals("%quests_done%", "1"),
            strict(mapOf("placeholder_equals" to mapOf("placeholder" to "%quests_done%", "value" to "1"))),
        )
        assertEquals(Condition.HasLevel(10), strict(mapOf("has_level" to 10)))
        assertEquals(Condition.TimeIs("100-200"), strict(mapOf("time_is" to mapOf("from_ticks" to 100, "to_ticks" to 200))))
    }

    @Test fun `reads nested operators`() {
        val parsed = strict(mapOf("or" to listOf(mapOf("has_level" to 5), mapOf("not" to mapOf("world_is" to "nether")))))
        assertEquals(
            Condition.Or(listOf(Condition.HasLevel(5), Condition.Not(Condition.WorldIs("nether")))),
            parsed,
        )
    }

    @Test fun `rejects an unknown name or a non-map entry`() {
        assertNull(strict(mapOf("has_permision" to "vip.use")))
        assertNull(strict(mapOf("type" to "nope")))
        assertNull(strict("has_permission"))
        assertNull(strict(mapOf("has_level" to 1, "has_xp" to 2)))
    }

    @Test fun `rejects what the tolerant read defaults`() {
        assertNull(strict(mapOf("has_permission" to null)))
        assertNull(strict(mapOf("has_permission" to "")))
        assertNull(strict(mapOf("has_level" to "ten")))
        assertNull(strict(mapOf("has_money" to mapOf("currency" to "gems"))))
        assertNull(strict(mapOf("has_item" to mapOf("count" to 2))))
        assertNull(strict(mapOf("placeholder_match" to mapOf("placeholder" to "%x%", "regex" to "(["))))
        assertNull(strict(mapOf("time_is" to mapOf("from_ticks" to 100))))
        assertNull(strict(mapOf("random_chance" to 2)))
        assertNull(strict(mapOf("expression" to " ")))
    }

    @Test fun `one bad operand fails the whole, where the tolerant read drops it`() {
        val raw = mapOf("and" to listOf(mapOf("has_level" to 5), mapOf("has_levle" to 5)))
        assertNull(strict(raw))
        assertNull(strict(mapOf("or" to emptyList<Any>())))
        assertNull(strict(mapOf("not" to mapOf("world_is" to ""))))
        assertEquals(listOf(Condition.And(listOf(Condition.HasLevel(5)))), KeyedStepParser.parseConditions(raw))
    }
}
