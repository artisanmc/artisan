package net.artisanmc.plugin.scheduling

import java.util.UUID

/**
 * Où une tâche s'exécute. Sur Folia et le parallel world ticking de Leaf, un
 * joueur n'est accessible que depuis le thread de sa région : [player] y route
 * la tâche, [global] vise l'état serveur (commandes console, config), [async]
 * tout ce qui ne touche pas au monde. Sur Paper, global et player se confondent
 * avec le thread principal.
 */
interface Scheduler {
    fun global(task: () -> Unit)
    fun globalLater(delayTicks: Long, task: () -> Unit)

    /** Si le joueur est ou passe hors ligne avant l'exécution, [onGone] remplace [task]. */
    fun player(playerId: UUID, onGone: () -> Unit = {}, task: () -> Unit)
    fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit)

    fun async(task: () -> Unit)
    fun asyncLater(delayTicks: Long, task: () -> Unit)

    /** Vrai si le thread courant peut toucher ce joueur sans changer de thread. */
    fun ownsPlayer(playerId: UUID): Boolean
    fun ownsGlobal(): Boolean

    /** Exécute tout de suite si le thread courant convient, sinon planifie. */
    fun onGlobal(task: () -> Unit) {
        if (ownsGlobal()) task() else global(task)
    }

    fun onPlayer(playerId: UUID, task: () -> Unit) {
        if (ownsPlayer(playerId)) task() else player(playerId, task = task)
    }

    /** Exécute tout immédiatement, sur le thread appelant. Pour les tests. */
    object Direct : Scheduler {
        override fun global(task: () -> Unit) = task()
        override fun globalLater(delayTicks: Long, task: () -> Unit) = task()
        override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = task()
        override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) = task()
        override fun async(task: () -> Unit) = task()
        override fun asyncLater(delayTicks: Long, task: () -> Unit) = task()
        override fun ownsPlayer(playerId: UUID) = true
        override fun ownsGlobal() = true
    }
}
