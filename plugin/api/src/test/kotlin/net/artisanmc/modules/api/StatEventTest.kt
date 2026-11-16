package net.artisanmc.modules.api

import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.modules.api.stats.StatKind
import net.artisanmc.modules.api.stats.StatScope
import net.artisanmc.modules.api.stats.StatStorage
import net.artisanmc.modules.api.stats.StatsApi
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull

class StatEventTest {
    @Test
    fun `a declaration defaults to a bucketed player counter without dimensions`() {
        val event = StatEvent.builder("quests:started").build()
        assertEquals("quests", event.namespace)
        assertEquals(StatStorage.BUCKETED, event.storage)
        assertEquals(StatKind.COUNTER, event.kind)
        assertEquals(StatScope.PLAYER, event.scope)
        assertEquals(emptyList(), event.dimensions)
        assertNull(event.valueName)
        assertEquals(0, event.rawRetentionDays)
    }

    @Test
    fun `every part of a declaration is kept and two equal declarations are equal`() {
        fun build() = StatEvent.builder("quests:completed").storage(StatStorage.BOTH).kind(StatKind.COUNTER)
            .scope(StatScope.PLAYER).dimensions("group", "quest").value("duration_seconds").rawRetentionDays(30).build()
        val event = build()
        assertEquals(listOf("group", "quest"), event.dimensions)
        assertEquals("duration_seconds", event.valueName)
        assertEquals(30, event.rawRetentionDays)
        assertEquals(build(), event)
        assertEquals(build().hashCode(), event.hashCode())
    }

    @Test
    fun `a name without namespace, upper case or too long is refused`() {
        for (name in listOf("started", "Quests:started", "quests:", ":started", "quests:started!", "quests:" + "a".repeat(41))) {
            assertFailsWith<IllegalArgumentException>(name) { StatEvent.builder(name) }
        }
        StatEvent.builder("conversations:page.seen").build()
    }

    @Test
    fun `dimensions are checked, unique and bounded`() {
        val b = StatEvent.builder("core:menu_click")
        assertFailsWith<IllegalArgumentException> { b.dimensions("Menu") }
        assertFailsWith<IllegalArgumentException> { b.dimensions("menu", "menu") }
        assertFailsWith<IllegalArgumentException> { b.dimensions("a", "b", "c", "d", "e", "f", "g") }
        assertFailsWith<IllegalArgumentException> { b.value("Duration") }
        assertFailsWith<IllegalArgumentException> { b.rawRetentionDays(0) }
    }

    @Test
    fun `storage says whether records go to buckets, raw rows or both`() {
        assertEquals(listOf(true, false, true), StatStorage.entries.map { it.bucketed() })
        assertEquals(listOf(false, true, true), StatStorage.entries.map { it.raw() })
    }

    @Test
    fun `the inert implementation records nothing and says statistics are off`() {
        StatsApi.NOOP.declare(StatEvent.builder("quests:started").build())
        StatsApi.NOOP.record("quests:started", UUID.randomUUID(), mapOf())
        assertFalse(StatsApi.NOOP.isDeclared("quests:started"))
        assertFalse(StatsApi.NOOP.isEnabled)
    }
}
