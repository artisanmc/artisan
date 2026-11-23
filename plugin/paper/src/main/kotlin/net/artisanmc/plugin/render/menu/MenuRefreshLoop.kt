package net.artisanmc.plugin.render.menu

import net.artisanmc.plugin.engine.MenuSession
import net.artisanmc.plugin.engine.MenuSessionStore
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.entity.Player
import java.util.logging.Logger

/**
 * Runs the [net.artisanmc.plugin.engine.MenuRefresh] of an opened menu every period, on the
 * player's thread, for as long as that same opening is the player's session: closing the
 * menu, opening another one, a repaint (`set`, pagination) or leaving ends it. One task per
 * open menu that has a `refresh_ticks` element, none otherwise.
 */
class MenuRefreshLoop(
    private val scheduler: Scheduler,
    private val sessions: MenuSessionStore,
    private val logger: Logger?,
) {
    fun start(player: Player, session: MenuSession) {
        val refresh = session.refresh ?: return
        val playerId = player.uniqueId
        fun next() {
            scheduler.playerLater(playerId, refresh.periodTicks) {
                if (!player.isOnline || sessions.get(player) !== session) return@playerLater
                val failed = runCatching { refresh.tick() }.exceptionOrNull()
                if (failed != null) {
                    // A broken template would fail every period: said once, then this opening stops refreshing.
                    logger?.warning("[Artisan] menu '${session.menuId}' stopped refreshing for ${player.name}: ${failed.message}")
                    return@playerLater
                }
                next()
            }
        }
        next()
    }
}
