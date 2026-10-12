package net.artisanmc.plugin.scheduling

import java.util.UUID

/** Toutes les tâches passent par [dispatch], quel que soit leur thread cible. */
class DispatchingScheduler(private val dispatch: (() -> Unit) -> Unit) : Scheduler {
    override fun global(task: () -> Unit) = dispatch(task)
    override fun globalLater(delayTicks: Long, task: () -> Unit) = dispatch(task)
    override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = dispatch(task)
    override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) = dispatch(task)
    override fun async(task: () -> Unit) = dispatch(task)
    override fun asyncLater(delayTicks: Long, task: () -> Unit) = dispatch(task)
    override fun ownsPlayer(playerId: UUID) = false
    override fun ownsGlobal() = false
}
