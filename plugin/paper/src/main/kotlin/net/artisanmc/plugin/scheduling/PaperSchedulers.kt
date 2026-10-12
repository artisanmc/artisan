package net.artisanmc.plugin.scheduling

import org.bukkit.plugin.Plugin
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Folia, Leaf et Paper exposent tous les schedulers régionalisés ; MockBukkit non. */
fun schedulerFor(plugin: Plugin): Scheduler =
    if (runCatching { plugin.server.globalRegionScheduler }.isSuccess) RegionizedScheduler(plugin)
    else BukkitTaskScheduler(plugin)

class RegionizedScheduler(private val plugin: Plugin) : Scheduler {
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

/** Scheduler Bukkit historique : un seul thread principal, joueurs compris. */
class BukkitTaskScheduler(private val plugin: Plugin) : Scheduler {
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

    override fun async(task: () -> Unit) {
        bukkit.runTaskAsynchronously(plugin, Runnable(task))
    }

    override fun asyncLater(delayTicks: Long, task: () -> Unit) {
        bukkit.runTaskLaterAsynchronously(plugin, Runnable(task), delayTicks)
    }

    override fun ownsPlayer(playerId: UUID) = plugin.server.isPrimaryThread
    override fun ownsGlobal() = plugin.server.isPrimaryThread
}
