package net.artisanmc.plugin.scheduling

import java.util.UUID

/**
 * Where a task runs. On Folia and Leaf's parallel world ticking, a player is only
 * reachable from its region's thread: [player] routes the task there, [global]
 * targets server state (console commands, config), [async] everything that does not
 * touch the world. On Paper, global and player are both the main thread.
 */
interface Scheduler {
    fun global(task: () -> Unit)
    fun globalLater(delayTicks: Long, task: () -> Unit)

    /** If the player is or goes offline before execution, [onGone] runs instead of [task]. */
    fun player(playerId: UUID, onGone: () -> Unit = {}, task: () -> Unit)
    fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit)

    /** On the thread that owns this chunk, after [delayTicks] (0 = as soon as possible). */
    fun region(worldId: UUID, chunkX: Int, chunkZ: Int, delayTicks: Long, task: () -> Unit) =
        if (delayTicks <= 0) global(task) else globalLater(delayTicks, task)

    fun async(task: () -> Unit)
    fun asyncLater(delayTicks: Long, task: () -> Unit)

    /** True if the current thread can touch this player without switching threads. */
    fun ownsPlayer(playerId: UUID): Boolean
    fun ownsGlobal(): Boolean

    /** Runs right away if the current thread fits, otherwise schedules. */
    fun onGlobal(task: () -> Unit) {
        if (ownsGlobal()) task() else global(task)
    }

    fun onPlayer(playerId: UUID, task: () -> Unit) {
        if (ownsPlayer(playerId)) task() else player(playerId, task = task)
    }

    /** Runs everything immediately on the calling thread. For tests. */
    object Direct : Scheduler {
        override fun global(task: () -> Unit) = task()
        override fun globalLater(delayTicks: Long, task: () -> Unit) = task()
        override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = task()
        override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) = task()
        override fun async(task: () -> Unit) = task()
        override fun asyncLater(delayTicks: Long, task: () -> Unit) = task()
        override fun region(worldId: UUID, chunkX: Int, chunkZ: Int, delayTicks: Long, task: () -> Unit) = task()
        override fun ownsPlayer(playerId: UUID) = true
        override fun ownsGlobal() = true
    }
}
