package net.artisanmc.plugin.scheduling

import org.bukkit.entity.Entity
import org.bukkit.plugin.Plugin
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Scheduling bound to an entity the caller already holds. Never by UUID: `Server.getEntity`
 * scans the worlds, which only a tick thread may do (Leaf and Folia throw "Asynchronous
 * Chunk getEntities call!" from an async task). The entity object needs no lookup.
 */
interface EntityScheduling {
    /**
     * On the thread that owns [entity], after [delayTicks] (0 = as soon as possible);
     * [onGone] instead if it is removed first. Callable from any thread.
     */
    fun entity(entity: Entity, delayTicks: Long, onGone: () -> Unit = {}, task: () -> Unit)

    fun ownsEntity(entity: Entity): Boolean
}

/** Folia, Leaf and Paper all expose the regionised schedulers; MockBukkit does not. */
fun schedulerFor(plugin: Plugin): Scheduler =
    if (runCatching { plugin.server.globalRegionScheduler }.isSuccess) RegionizedScheduler(plugin)
    else BukkitTaskScheduler(plugin)

class RegionizedScheduler(private val plugin: Plugin) : Scheduler, EntityScheduling {
    private val server get() = plugin.server

    override fun global(task: () -> Unit) {
        server.globalRegionScheduler.execute(plugin, Runnable(task))
    }

    override fun globalLater(delayTicks: Long, task: () -> Unit) {
        server.globalRegionScheduler.runDelayed(plugin, { task() }, delayTicks.coerceAtLeast(1))
    }

    override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) {
        val scheduled = server.getPlayer(playerId)?.scheduler?.run(plugin, { task() }, Runnable(onGone))
        if (scheduled == null) onGone()
    }

    override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) {
        server.getPlayer(playerId)?.scheduler?.runDelayed(plugin, { task() }, null, delayTicks.coerceAtLeast(1))
    }

    override fun entity(entity: Entity, delayTicks: Long, onGone: () -> Unit, task: () -> Unit) {
        // EntityScheduler is thread-safe; it answers null once the entity is retired.
        val scheduler = entity.scheduler
        val scheduled =
            if (delayTicks <= 0) scheduler.run(plugin, { task() }, Runnable(onGone))
            else scheduler.runDelayed(plugin, { task() }, Runnable(onGone), delayTicks)
        if (scheduled == null) onGone()
    }

    override fun region(worldId: UUID, chunkX: Int, chunkZ: Int, delayTicks: Long, task: () -> Unit) {
        val world = server.getWorld(worldId) ?: return
        if (delayTicks <= 0) server.regionScheduler.execute(plugin, world, chunkX, chunkZ, Runnable(task))
        else server.regionScheduler.runDelayed(plugin, world, chunkX, chunkZ, { task() }, delayTicks)
    }

    override fun ownsEntity(entity: Entity) = server.isOwnedByCurrentRegion(entity)

    override fun async(task: () -> Unit) {
        server.asyncScheduler.runNow(plugin) { task() }
    }

    override fun asyncLater(delayTicks: Long, task: () -> Unit) {
        server.asyncScheduler.runDelayed(plugin, { task() }, delayTicks.coerceAtLeast(1) * 50, TimeUnit.MILLISECONDS)
    }

    override fun ownsPlayer(playerId: UUID): Boolean {
        val player = server.getPlayer(playerId) ?: return false
        return server.isOwnedByCurrentRegion(player)
    }

    override fun ownsGlobal() = server.isGlobalTickThread
}

/** Classic Bukkit scheduler: a single main thread, players included. */
class BukkitTaskScheduler(private val plugin: Plugin) : Scheduler, EntityScheduling {
    private val bukkit get() = plugin.server.scheduler

    override fun global(task: () -> Unit) {
        bukkit.runTask(plugin, Runnable(task))
    }

    override fun globalLater(delayTicks: Long, task: () -> Unit) {
        bukkit.runTaskLater(plugin, Runnable(task), delayTicks)
    }

    override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = global {
        if (plugin.server.getPlayer(playerId) != null) task() else onGone()
    }

    override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) = globalLater(delayTicks) {
        if (plugin.server.getPlayer(playerId) != null) task()
    }

    override fun entity(entity: Entity, delayTicks: Long, onGone: () -> Unit, task: () -> Unit) {
        val run = { if (entity.isValid) task() else onGone() }
        if (delayTicks <= 0) global(run) else globalLater(delayTicks, run)
    }

    override fun async(task: () -> Unit) {
        bukkit.runTaskAsynchronously(plugin, Runnable(task))
    }

    override fun asyncLater(delayTicks: Long, task: () -> Unit) {
        bukkit.runTaskLaterAsynchronously(plugin, Runnable(task), delayTicks)
    }

    override fun ownsEntity(entity: Entity) = plugin.server.isPrimaryThread
    override fun ownsPlayer(playerId: UUID) = plugin.server.isPrimaryThread
    override fun ownsGlobal() = plugin.server.isPrimaryThread
}
