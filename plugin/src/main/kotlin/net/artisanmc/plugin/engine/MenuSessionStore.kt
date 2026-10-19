package net.artisanmc.plugin.engine

import org.bukkit.entity.Player
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class MenuSession(
    val menuId: String,
    val ctx: ExecutionContext,
    val activeClicks: Map<Int, Map<ClickType, ClickHandler>>,
    val slotArgs: Map<Int, Map<String, Any>> = emptyMap(),
    /** Contenu de la fenêtre (l'ancre Bukkit reste vide). */
    val slots: net.artisanmc.plugin.render.MenuSlots = net.artisanmc.plugin.render.MenuSlots(0),
    val escapeGoesBack: Boolean = false,
    /** menu/v1 `refresh_interval` du menu, en secondes (0 = jamais). */
    val refreshInterval: Int = 0,
)

class MenuSessionStore {
    private val sessions = ConcurrentHashMap<UUID, MenuSession>()
    fun set(player: Player, session: MenuSession) { sessions[player.uniqueId] = session }
    fun get(player: Player): MenuSession? = sessions[player.uniqueId]
    fun remove(player: Player) { sessions.remove(player.uniqueId) }
    /** Joueurs ayant un menu ouvert, avec sa session (copie). */
    fun all(): Map<UUID, MenuSession> = HashMap(sessions)
}
