package net.artisanmc.plugin.scheduling

import net.artisanmc.modules.api.scheduler.SchedulerApi
import net.artisanmc.modules.api.scheduler.TaskScheduler
import org.bukkit.Location
import org.bukkit.entity.Entity
import org.bukkit.plugin.Plugin

/** `api.scheduler`: the scheduler port, owned by the calling plugin. */
object PaperSchedulerApi : SchedulerApi {
    override fun forPlugin(owner: Plugin): TaskScheduler = PortTaskScheduler(schedulerFor(owner))
}

class PortTaskScheduler(private val port: Scheduler) : TaskScheduler {
    /** A port without entity scheduling (tests) runs entity tasks on the global thread. */
    private val entities: EntityScheduling = port as? EntityScheduling ?: object : EntityScheduling {
        override fun entity(entity: Entity, delayTicks: Long, onGone: () -> Unit, task: () -> Unit) =
            if (delayTicks <= 0) port.global(task) else port.globalLater(delayTicks, task)

        override fun ownsEntity(entity: Entity) = port.ownsGlobal()
    }

    override fun runGlobal(task: Runnable) = port.global(task::run)

    override fun runGlobalLater(delayTicks: Long, task: Runnable) =
        if (delayTicks <= 0) port.global(task::run) else port.globalLater(delayTicks, task::run)

    override fun runAt(location: Location, task: Runnable) = runAtLater(location, 0, task)

    override fun runAtLater(location: Location, delayTicks: Long, task: Runnable) {
        val world = requireNotNull(location.world) { "Location without a world" }
        port.region(world.uid, location.blockX shr 4, location.blockZ shr 4, delayTicks, task::run)
    }

    override fun runFor(entity: Entity, task: Runnable) = entities.entity(entity, 0, task = task::run)

    override fun runForLater(entity: Entity, delayTicks: Long, task: Runnable) =
        entities.entity(entity, delayTicks, task = task::run)

    override fun runAsync(task: Runnable) = port.async(task::run)

    override fun runAsyncLater(delayTicks: Long, task: Runnable) =
        if (delayTicks <= 0) port.async(task::run) else port.asyncLater(delayTicks, task::run)

    override fun isOwnedByCurrentThread(entity: Entity) = entities.ownsEntity(entity)

    override fun isGlobalThread() = port.ownsGlobal()
}
