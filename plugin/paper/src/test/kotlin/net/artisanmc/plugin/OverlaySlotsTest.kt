package net.artisanmc.plugin

import net.artisanmc.modules.api.text.OverlayApi.Slot
import net.artisanmc.plugin.resourcepack.OverlaySlots
import net.artisanmc.plugin.scheduling.Scheduler
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class OverlaySlotsTest {

    /** Runs a task now; keeps a later one until [tick]. */
    private class TickScheduler : Scheduler {
        val later = mutableListOf<() -> Unit>()
        fun tick() = later.toList().also { later.clear() }.forEach { it() }
        override fun global(task: () -> Unit) = task()
        override fun globalLater(delayTicks: Long, task: () -> Unit) { later += task }
        override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = task()
        override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) { later += task }
        override fun async(task: () -> Unit) = task()
        override fun asyncLater(delayTicks: Long, task: () -> Unit) { later += task }
        override fun ownsPlayer(playerId: UUID) = true
        override fun ownsGlobal() = true
    }

    private val player = UUID.randomUUID()
    private val scheduler = TickScheduler()
    private val sent = mutableListOf<String>()
    private val slots = OverlaySlots(scheduler) { _, _, line -> sent += line }

    @Test
    fun `layers are drawn by priority, then in the order they first showed`() {
        slots.show(player, Slot.ACTION_BAR, "quests:goal", 0, "Q")
        slots.show(player, Slot.ACTION_BAR, "conversations:hud", 10, "C")
        slots.show(player, Slot.ACTION_BAR, "boosts:timer", 0, "B")
        assertEquals("QBC", slots.line(player, Slot.ACTION_BAR))
        // Replacing a layer keeps its place.
        slots.show(player, Slot.ACTION_BAR, "quests:goal", 0, "q")
        assertEquals(listOf("Q", "QC", "QBC", "qBC"), sent)
    }

    @Test
    fun `the slot is sent again while a layer is there, and cleared after the last`() {
        slots.show(player, Slot.ACTION_BAR, "a", 0, "A")
        slots.show(player, Slot.ACTION_BAR, "b", 0, "B")
        assertEquals(1, scheduler.later.size)
        scheduler.tick()
        assertEquals(listOf("A", "AB", "AB"), sent)
        slots.hide(player, Slot.ACTION_BAR, "a")
        slots.hide(player, Slot.ACTION_BAR, "b")
        assertEquals("", sent.last())
        scheduler.tick()
        // No layer left: the resend stops without sending.
        assertEquals(5, sent.size)
        assertEquals(0, scheduler.later.size)
        slots.hide(player, Slot.ACTION_BAR, "b")
        assertEquals(5, sent.size)
    }
}
