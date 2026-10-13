package net.artisanmc.plugin.scheduling

import net.artisanmc.modules.api.SchedulerApi
import net.artisanmc.modules.api.TaskScheduler
import org.bukkit.Location
import org.bukkit.entity.Entity
import org.bukkit.plugin.Plugin

/** `api.scheduler`: the scheduler port, owned by the calling plugin. */
object PaperSchedulerApi : SchedulerApi {
    override fun forPlugin(owner: Plugin): TaskScheduler = PortTaskScheduler(schedulerFor(owner))
}

class PortTaskScheduler(private val port: Scheduler) : TaskScheduler {
    override fun runGlobal(task: Runnable) = port.global(task::run)

    override fun runGlobalLater(delayTicks: Long, task: Runnable) =
        if (delayTicks <= 0) port.global(task::run) else port.globalLater(delayTicks, task::run)

    override fun runAt(location: Location, task: Runnable) = runAtLater(location, 0, task)

    override fun runAtLater(location: Location, delayTicks: Long, task: Runnable) {
        val world = requireNotNull(location.world) { "Location without a world" }
        port.region(world.uid, location.blockX shr 4, location.blockZ shr 4, delayTicks, task::run)
    }

    override fun runFor(entity: Entity, task: Runnable) = port.entity(entity.uniqueId, 0, task = task::run)

    override fun runForLater(entity: Entity, delayTicks: Long, task: Runnable) =
        port.entity(entity.uniqueId, delayTicks, task = task::run)

    override fun runAsync(task: Runnable) = port.async(task::run)

    override fun runAsyncLater(delayTicks: Long, task: Runnable) =
        if (delayTicks <= 0) port.async(task::run) else port.asyncLater(delayTicks, task::run)

    override fun isOwnedByCurrentThread(entity: Entity) = port.ownsEntity(entity.uniqueId)

    override fun isGlobalThread() = port.ownsGlobal()
}
