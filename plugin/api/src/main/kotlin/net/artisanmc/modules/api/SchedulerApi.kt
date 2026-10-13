package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.Location
import org.bukkit.entity.Entity
import org.bukkit.plugin.Plugin

/**
 * Artisan's scheduler (`api.scheduler`), the one it uses itself: right on Paper, Folia
 * and Leaf alike. On Paper every thread but async is the main thread.
 */
@Beta
interface SchedulerApi {
    /** Tasks belong to [owner]: the server cancels them when that plugin disables. */
    fun forPlugin(owner: Plugin): TaskScheduler

    companion object {
        /** Runs every task at once on the calling thread (tests / partial wiring). */
        @JvmField
        val DIRECT: SchedulerApi = object : SchedulerApi {
            override fun forPlugin(owner: Plugin): TaskScheduler = TaskScheduler.DIRECT
        }
    }
}

/**
 * Delays are in ticks (20 per second); 0 runs as soon as possible. Tasks cannot be
 * cancelled once scheduled: check your own state when they run.
 */
@Beta
interface TaskScheduler {
    /** Server-wide state: console commands, worlds, the scoreboard. */
    fun runGlobal(task: Runnable)
    fun runGlobalLater(delayTicks: Long, task: Runnable)

    /** The region owning [location]: blocks and what stands there. */
    fun runAt(location: Location, task: Runnable)
    fun runAtLater(location: Location, delayTicks: Long, task: Runnable)

    /** The thread owning [entity] (a player: their region); skipped if it is removed first. */
    fun runFor(entity: Entity, task: Runnable)
    fun runForLater(entity: Entity, delayTicks: Long, task: Runnable)

    /** Off the game threads: I/O, SQL, HTTP. Never touch the world from here. */
    fun runAsync(task: Runnable)
    fun runAsyncLater(delayTicks: Long, task: Runnable)

    /** True if the calling thread may touch [entity] right now. */
    fun isOwnedByCurrentThread(entity: Entity): Boolean

    /** True on the global thread (Paper: the main thread). */
    fun isGlobalThread(): Boolean

    companion object {
        @JvmField
        val DIRECT: TaskScheduler = object : TaskScheduler {
            override fun runGlobal(task: Runnable) = task.run()
            override fun runGlobalLater(delayTicks: Long, task: Runnable) = task.run()
            override fun runAt(location: Location, task: Runnable) = task.run()
            override fun runAtLater(location: Location, delayTicks: Long, task: Runnable) = task.run()
            override fun runFor(entity: Entity, task: Runnable) = task.run()
            override fun runForLater(entity: Entity, delayTicks: Long, task: Runnable) = task.run()
            override fun runAsync(task: Runnable) = task.run()
            override fun runAsyncLater(delayTicks: Long, task: Runnable) = task.run()
            override fun isOwnedByCurrentThread(entity: Entity) = true
            override fun isGlobalThread() = true
        }
    }
}
