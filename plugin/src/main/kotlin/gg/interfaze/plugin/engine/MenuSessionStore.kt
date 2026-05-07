package gg.interfaze.plugin.engine

import org.bukkit.entity.Player
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class MenuSession(
    val menuId: String,
    val ctx: ExecutionContext,
    val activeClicks: Map<Int, Map<ClickType, ClickHandler>>,
)

class MenuSessionStore {
    private val sessions = ConcurrentHashMap<UUID, MenuSession>()
    fun set(player: Player, session: MenuSession) { sessions[player.uniqueId] = session }
    fun get(player: Player): MenuSession? = sessions[player.uniqueId]
    fun remove(player: Player) { sessions.remove(player.uniqueId) }
}
