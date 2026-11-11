package net.artisanmc.plugin.scheduling

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class SchedulerTest {
    private class Recording(private val owns: Boolean) : Scheduler {
        val log = mutableListOf<String>()
        override fun global(task: () -> Unit) { log += "global"; task() }
        override fun globalLater(delayTicks: Long, task: () -> Unit) = global(task)
        override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) { log += "player"; task() }
        override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) = player(playerId, task = task)
        override fun async(task: () -> Unit) = task()
        override fun asyncLater(delayTicks: Long, task: () -> Unit) = task()
        override fun ownsPlayer(playerId: UUID) = owns
        override fun ownsGlobal() = owns
    }

    @Test
    fun `runs inline on the owning thread`() {
        val scheduler = Recording(owns = true)
        scheduler.onPlayer(UUID.randomUUID()) { scheduler.log += "ran" }
        scheduler.onGlobal { scheduler.log += "ran" }
        assertEquals(listOf("ran", "ran"), scheduler.log)
    }

    @Test
    fun `hops threads otherwise`() {
        val scheduler = Recording(owns = false)
        scheduler.onPlayer(UUID.randomUUID()) { scheduler.log += "ran" }
        scheduler.onGlobal { scheduler.log += "ran" }
        assertEquals(listOf("player", "ran", "global", "ran"), scheduler.log)
    }
}
