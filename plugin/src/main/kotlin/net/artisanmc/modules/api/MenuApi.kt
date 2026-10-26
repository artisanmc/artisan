package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player

/**
 * Repaint the Artisan menus players have open, after a module changed the data
 * they show (an auction sold, a stock changed). The menu is rendered again in
 * the window already open, so the cursor does not move: its data sources are
 * fetched again, its args and pages are kept, its title stays as opened.
 * A menu can also repaint itself on a timer with menu/v1 `refresh_interval`.
 *
 * Main server thread only: a call from another thread is dispatched to it.
 */
@Beta
interface MenuApi {
    /** Repaints the menu [player] has open. Nothing happens without an open menu. */
    fun refresh(player: Player)

    /** Repaints [menuId] for every player who has it open. */
    fun refreshAll(menuId: String)

    /** Id of the Artisan menu [player] has open, or null. Main thread only. */
    fun openMenuId(player: Player): String?

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: MenuApi = object : MenuApi {
            override fun refresh(player: Player) {}
            override fun refreshAll(menuId: String) {}
            override fun openMenuId(player: Player): String? = null
        }
    }
}
