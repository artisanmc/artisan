package net.artisanmc.plugin.engine

import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.Bukkit
import org.bukkit.entity.Player

/**
 * Re-rend un menu ouvert dans sa fenêtre : ses sources sont relues (comme après
 * `set_arg`), args de navigation et pages conservés. Sert `api.menus` et
 * `refresh_interval`. Thread principal uniquement.
 */
class MenuRefresher(
    private val sessions: MenuSessionStore,
    private val menuProvider: () -> MenuProvider?,
) {
    private var seconds = 0L

    /** false quand [player] n'a pas de menu Artisan ouvert. */
    fun refresh(player: Player): Boolean {
        val session = sessions.get(player) ?: return false
        val provider = menuProvider() ?: return false
        val ctx = session.ctx.copy(args = session.ctx.navigationArgs, sourceArgs = emptyMap())
        runCatching { provider.repaintMenu(player, session.menuId, ctx.lang, ctx) }
            .onFailure { Bukkit.getLogger().warning("[Artisan] menu '${session.menuId}' repaint failed: ${it.message}") }
        return true
    }

    /** Re-rend [menuId] chez chaque joueur qui l'a ouvert ; renvoie leur nombre. */
    fun refreshAll(menuId: String): Int = viewers { it.menuId == menuId }.count { refresh(it) }

    /** Appelé une fois par seconde : repaint des menus dont `refresh_interval` tombe. */
    fun tick() {
        seconds++
        viewers { it.refreshInterval > 0 && seconds % it.refreshInterval == 0L }.forEach { refresh(it) }
    }

    fun openMenuId(player: Player): String? = sessions.get(player)?.menuId

    private fun viewers(match: (MenuSession) -> Boolean): List<Player> =
        sessions.all().filterValues(match).keys.mapNotNull { Bukkit.getPlayer(it) }
}
