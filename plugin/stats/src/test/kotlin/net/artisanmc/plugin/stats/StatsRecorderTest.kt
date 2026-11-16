package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.modules.api.stats.StatKind
import net.artisanmc.modules.api.stats.StatScope
import net.artisanmc.modules.api.stats.StatStorage
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StatsRecorderTest {
    private var now = 1_700_000_000_000L // 2023-11-14T22:13:20Z
    private val warnings = mutableListOf<String>()
    private val stats = StatsRecorder(clock = { now }, warn = { warnings += it })
    private val alice = UUID.fromString("00000000-0000-0000-0000-00000000000a")
    private val hour = 1_699_999_200L // 22:00 UTC, in seconds

    private fun click() = StatEvent.builder("menus:click").dimensions("menu", "element").build()

    @Test
    fun `records of one player, event, dimensions and hour merge into one bucket`() {
        stats.declare(click())
        stats.record("menus:click", alice, mapOf("menu" to "shop", "element" to "buy"))
        now += 60_000
        stats.record("menus:click", alice, mapOf("element" to "buy", "menu" to "shop"))
        stats.record("menus:click", alice, mapOf("menu" to "shop", "element" to "sell"))
        val batch = stats.buffer.drain()
        assertEquals(
            setOf(
                BucketRow(alice.toString(), "menus:click", "element=buy&menu=shop", hour, Granularity.HOUR, 2, 2.0, 1.0, 1.0),
                BucketRow(alice.toString(), "menus:click", "element=sell&menu=shop", hour, Granularity.HOUR, 1, 1.0, 1.0, 1.0),
            ),
            batch.buckets.toSet(),
        )
        assertEquals(emptyList(), batch.raws)
        assertTrue(stats.buffer.drain().isEmpty())
    }

    @Test
    fun `a raw event keeps each occurrence with its details, both keeps a bucket too`() {
        stats.declare(StatEvent.builder("quests:completed").storage(StatStorage.BOTH).dimensions("quest").value("duration_seconds").build())
        stats.record("quests:completed", alice, mapOf("quest" to "mine"), 412.0, mapOf("uid" to "q-1"))
        stats.record("quests:completed", alice, mapOf("quest" to "mine"), 100.0, mapOf())
        val batch = stats.buffer.drain()
        assertEquals(listOf(BucketRow(alice.toString(), "quests:completed", "quest=mine", hour, Granularity.HOUR, 2, 512.0, 100.0, 412.0)), batch.buckets)
        assertEquals(
            listOf(
                RawRow(alice.toString(), "quests:completed", now, "quest=mine", 412.0, """{"uid":"q-1"}"""),
                RawRow(alice.toString(), "quests:completed", now, "quest=mine", 100.0, "{}"),
            ),
            batch.raws,
        )
    }

    @Test
    fun `a server gauge has no player and keeps min and max`() {
        stats.declare(StatEvent.builder("test:online").kind(StatKind.GAUGE).scope(StatScope.SERVER).build())
        stats.recordServer("test:online", mapOf(), 3.0)
        stats.recordServer("test:online", mapOf(), 7.0)
        assertEquals(listOf(BucketRow("", "test:online", "", hour, Granularity.HOUR, 2, 10.0, 3.0, 7.0)), stats.buffer.drain().buckets)
    }

    @Test
    fun `wrong records are dropped with one warning per event, never thrown`() {
        stats.declare(click())
        stats.declare(StatEvent.builder("test:online").scope(StatScope.SERVER).build())
        stats.record("menus:nope", alice, mapOf())
        stats.record("menus:nope", alice, mapOf())
        stats.record("menus:click", alice, mapOf("color" to "red"))
        stats.recordServer("menus:click", mapOf(), 1.0)
        stats.record("test:online", alice, mapOf())
        stats.record("menus:click", alice, mapOf("menu" to "shop"), Double.NaN)
        assertTrue(stats.buffer.drain().isEmpty())
        assertEquals(3, warnings.size, warnings.toString())
    }

    @Test
    fun `a missing dimension is recorded empty`() {
        stats.declare(click())
        stats.record("menus:click", alice, mapOf("menu" to "shop"))
        assertEquals("element=&menu=shop", stats.buffer.drain().buckets.single().dims)
    }

    @Test
    fun `values are cut to 64 characters and past 200 distinct values become other`() {
        stats.declare(StatEvent.builder("test:pick").dimensions("item").build())
        stats.record("test:pick", alice, mapOf("item" to "x".repeat(100)))
        assertEquals("item=" + "x".repeat(64), stats.buffer.drain().buckets.single().dims)
        repeat(199) { stats.record("test:pick", alice, mapOf("item" to "i$it")) }
        stats.record("test:pick", alice, mapOf("item" to "late"))
        stats.record("test:pick", alice, mapOf("item" to "i3"))
        val dims = stats.buffer.drain().buckets.map { it.dims }.toSet()
        assertTrue("item=other" in dims)
        assertFalse("item=late" in dims)
        assertTrue("item=i3" in dims)
        assertEquals(1, warnings.size, warnings.toString())
    }

    @Test
    fun `declaring again the same shape is fine, another shape or Artisan's namespace is refused`() {
        stats.declare(click())
        stats.declare(click())
        assertTrue(stats.isDeclared("menus:click"))
        assertFailsWith<IllegalArgumentException> { stats.declare(StatEvent.builder("menus:click").dimensions("menu").build()) }
        assertFailsWith<IllegalArgumentException> { stats.declare(StatEvent.builder("core:session").build()) }
        assertFailsWith<IllegalArgumentException> { stats.declare(StatEvent.builder("custom:x").build()) }
        stats.declareCore(StatEvent.builder("core:session").storage(StatStorage.RAW).build())
        assertTrue(stats.isDeclared("core:session"))
    }

    @Test
    fun `turned off or a disabled event records nothing`() {
        val off = StatsRecorder(clock = { now }, warn = { warnings += it }, settings = { StatsSettings(enabled = false) })
        off.declare(click())
        off.record("menus:click", alice, mapOf())
        assertFalse(off.isEnabled)
        assertTrue(off.buffer.drain().isEmpty())
        val some = StatsRecorder(clock = { now }, warn = { warnings += it }, settings = { StatsSettings(disabledEvents = setOf("menus:click")) })
        some.declare(click())
        some.record("menus:click", alice, mapOf())
        assertTrue(some.buffer.drain().isEmpty())
        assertEquals(emptyList(), warnings)
    }

    @Test
    fun `a custom event is declared on its first record and takes any dimension`() {
        stats.recordCustom("tutorial_step", alice, mapOf("step" to "2"), 1.0)
        stats.recordCustom("tutorial_step", alice, mapOf("step" to "3", "path" to "a"), 1.0)
        val batch = stats.buffer.drain()
        assertTrue(stats.isDeclared("custom:tutorial_step"))
        assertEquals(setOf("step=2", "path=a&step=3"), batch.buckets.map { it.dims }.toSet())
        assertEquals(2, batch.raws.size)
        stats.recordCustom("Bad Name", alice, mapOf(), 1.0)
        stats.recordCustom("tutorial_step", alice, mapOf("Step" to "1"), 1.0)
        assertTrue(stats.buffer.drain().isEmpty())
        assertEquals(2, warnings.size, warnings.toString())
    }

    @Test
    fun `a failed write is put back and merges with what came since`() {
        stats.declare(StatEvent.builder("test:hit").storage(StatStorage.BOTH).build())
        stats.record("test:hit", alice, mapOf())
        val failed = stats.buffer.drain()
        stats.record("test:hit", alice, mapOf())
        stats.buffer.restore(failed)
        val batch = stats.buffer.drain()
        assertEquals(2, batch.buckets.single().count)
        assertEquals(2, batch.raws.size)
    }

    @Test
    fun `raw rows past the bound drop the oldest, buckets are kept`() {
        val small = StatsRecorder(clock = { now }, warn = { warnings += it }, maxRaw = 3)
        small.declare(StatEvent.builder("test:hit").storage(StatStorage.BOTH).build())
        repeat(5) { small.record("test:hit", alice, mapOf(), it.toDouble(), mapOf()) }
        val batch = small.buffer.drain()
        assertEquals(listOf(2.0, 3.0, 4.0), batch.raws.map { it.value })
        assertEquals(5, batch.buckets.single().count)
        assertEquals(2, small.buffer.dropped())
    }

    @Test
    fun `forgetting a player drops their buffered records only`() {
        val bob = UUID.randomUUID()
        stats.declare(StatEvent.builder("test:hit").storage(StatStorage.BOTH).build())
        stats.record("test:hit", alice, mapOf())
        stats.record("test:hit", bob, mapOf())
        stats.buffer.forget(alice.toString())
        val batch = stats.buffer.drain()
        assertEquals(listOf(bob.toString()), batch.buckets.map { it.player })
        assertEquals(listOf(bob.toString()), batch.raws.map { it.player })
    }

    @Test
    fun `the raw retention of each event is known`() {
        stats.declare(StatEvent.builder("test:a").storage(StatStorage.RAW).rawRetentionDays(7).build())
        stats.declare(StatEvent.builder("test:b").storage(StatStorage.RAW).build())
        assertEquals(mapOf("test:a" to 7), stats.rawRetentions())
    }
}
