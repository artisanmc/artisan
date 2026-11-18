package net.artisanmc.plugin.updates

import java.util.concurrent.atomic.AtomicBoolean

/**
 * The restart the editor may ask for once jars are staged (ADR `site-account-and-module-updates`).
 * Players are told, then the server restarts after [DELAY_SECONDS]. Whether it comes back up is
 * the host's doing, not the plugin's: the editor says so before it asks.
 *
 * No Bukkit here: the caller gives what tells the players, what waits and what restarts.
 */
class ServerRestart(
    /** Tells every player the server restarts in that many seconds. */
    private val announce: (seconds: Int) -> Unit,
    /** Runs the task on the server's main thread after that many ticks. */
    private val later: (ticks: Long, task: () -> Unit) -> Unit,
    private val restart: () -> Unit,
) {
    private val pending = AtomicBoolean(false)

    /** Why the restart is refused, null when it is on its way. */
    fun request(): String? {
        if (!pending.compareAndSet(false, true)) return "restart_in_progress"
        announce(DELAY_SECONDS)
        later(DELAY_SECONDS * 20L) { restart() }
        return null
    }

    companion object {
        const val DELAY_SECONDS = 10
    }
}
