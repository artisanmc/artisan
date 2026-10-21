package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.scheduling.Scheduler
import java.nio.file.Files
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The module and command changes of one tick make one presence report and one seed:
 * at start, each module and each of its commands announces itself before the first tick.
 */
class ModulesChangedCoalescingTest {
    /** Holds the global tasks until [tick], like the server between two ticks. */
    private class Ticking : Scheduler {
        val queued = mutableListOf<() -> Unit>()
        fun tick() { val tasks = queued.toList(); queued.clear(); tasks.forEach { it() } }
        override fun global(task: () -> Unit) { queued += task }
        override fun globalLater(delayTicks: Long, task: () -> Unit) { queued += task }
        override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = task()
        override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) = task()
        override fun async(task: () -> Unit) = task()
        override fun asyncLater(delayTicks: Long, task: () -> Unit) = task()
        override fun ownsPlayer(playerId: UUID) = false
        override fun ownsGlobal() = false
    }

    @Test
    fun `the changes of one tick make one presence report`() {
        val scheduler = Ticking()
        var reports = 0
        val provider = SyncedMenuProvider(
            roots = ProjectRoots(Files.createTempDirectory("artisan-modules-changed").toFile()),
            logger = null,
            announcement = { reports++; net.artisanmc.plugin.protocol.ServerAnnouncement.EMPTY },
            scheduler = scheduler,
        )
        try {
            repeat(5) { provider.notifyModulesChanged() }
            assertEquals(0, reports, "nothing before the tick")
            assertEquals(1, scheduler.queued.size, "one task for the five changes")
            scheduler.tick()
            assertEquals(1, reports)
            provider.notifyModulesChanged()
            scheduler.tick()
            assertEquals(2, reports, "a change after the tick reports again")
        } finally {
            provider.shutdown()
        }
    }
}
