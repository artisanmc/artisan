package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.menu.MenuRef
import org.bukkit.entity.Player
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class MenuSession(
    val menuId: String,
    val ctx: ExecutionContext,
    val activeClicks: Map<Int, Map<ClickType, ClickHandler>>,
    val slotArgs: Map<Int, Map<String, Any>> = emptyMap(),
    /** The window's contents (the Bukkit anchor stays empty). */
    val slots: net.artisanmc.plugin.session.MenuSlots = net.artisanmc.plugin.session.MenuSlots(0),
    val escapeGoesBack: Boolean = false,
    /** The element id behind each clickable slot (`core:menu_click`). */
    val slotElements: Map<Int, String> = emptyMap(),
    /** Redraws the elements that have a `refresh_ticks`; null when none has. */
    val refresh: MenuRefresh? = null,
) {
    val ref: MenuRef get() = MenuRef(ctx.projectId, menuId)
}

/**
 * The elements of an open menu that redraw themselves (`refresh_ticks`). [tick] runs every
 * [periodTicks] on the player's thread, as long as the menu it was rendered for stays open;
 * it rewrites only the slots whose item changed.
 */
interface MenuRefresh {
    val periodTicks: Long
    fun tick()
}

class MenuSessionStore {
    private val sessions = ConcurrentHashMap<UUID, MenuSession>()
    fun set(player: Player, session: MenuSession) { sessions[player.uniqueId] = session }
    fun get(player: Player): MenuSession? = sessions[player.uniqueId]
    fun remove(player: Player) { sessions.remove(player.uniqueId) }
}
