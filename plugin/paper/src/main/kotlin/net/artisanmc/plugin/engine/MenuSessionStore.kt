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
    val slots: net.artisanmc.plugin.render.MenuSlots = net.artisanmc.plugin.render.MenuSlots(0),
    val escapeGoesBack: Boolean = false,
) {
    val ref: MenuRef get() = MenuRef(ctx.projectId, menuId)
}

class MenuSessionStore {
    private val sessions = ConcurrentHashMap<UUID, MenuSession>()
    fun set(player: Player, session: MenuSession) { sessions[player.uniqueId] = session }
    fun get(player: Player): MenuSession? = sessions[player.uniqueId]
    fun remove(player: Player) { sessions.remove(player.uniqueId) }
}
