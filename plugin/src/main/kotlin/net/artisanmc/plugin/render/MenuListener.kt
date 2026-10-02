package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.*
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.inventory.InventoryClickEvent
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.inventory.InventoryDragEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.plugin.Plugin

class MenuListener(
    private val plugin: Plugin,
    private val sessions: MenuSessionStore,
    private val executor: ActionExecutor,
    private val windows: MenuWindows? = null,
    private val history: NavigationHistoryStore? = null,
    private val resync: (Player) -> Unit = { it.updateInventory() },
) : Listener {

    @EventHandler
    fun onClick(event: InventoryClickEvent) {
        if (event.inventory.holder !is ArtisanMenuHolder) return
        event.isCancelled = true
        val player = event.whoClicked as? Player ?: return
        resendNextTick(player, event.inventory)
        val session = sessions.get(player)
        val clickType = event.click.toIfzClickType()
        val handler = session?.activeClicks?.get(event.rawSlot)?.get(clickType)
        handler ?: return
        val slotCtx = session!!.ctx.copy(
            args = session.ctx.args + (session.slotArgs[event.rawSlot] ?: emptyMap()),
        )
        // Bukkit forbids opening/closing an inventory inside InventoryClickEvent:
        // the client then misses every slot whose item is unchanged from the
        // previous menu (decoration panes on the same slots). Next tick.
        plugin.server.scheduler.runTask(plugin, Runnable { executor.handle(handler, slotCtx) })
    }

    @EventHandler
    fun onDrag(event: InventoryDragEvent) {
        if (event.inventory.holder !is ArtisanMenuHolder) return
        event.isCancelled = true
        (event.whoClicked as? Player)?.let { resendNextTick(it, event.inventory) }
    }

    /** Le contenu n'existant que côté client, c'est à nous d'annuler sa prédiction. */
    private fun resendNextTick(player: Player, anchor: org.bukkit.inventory.Inventory) {
        val window = windows?.get(player.uniqueId)?.takeIf { it.anchor === anchor } ?: return
        plugin.server.scheduler.runTask(plugin, Runnable {
            if (windows.get(player.uniqueId) === window) window.resend()
        })
    }

    @EventHandler
    fun onClose(event: InventoryCloseEvent) {
        if (event.inventory.holder is ArtisanMenuHolder) {
            val player = event.player as? Player ?: return
            sessions.remove(player)
            forgetNavigationIfClosed(player)
            // Le client a affiché le contenu du menu dans son propre inventaire
            // (les slots du bas d'une fenêtre pointent vers lui) : resynchro du
            // vrai contenu une fois la fenêtre fermée. Seulement si c'est bien
            // cette ancre : ouvrir B depuis A ferme A après avoir posé B.
            if (windows?.release(player, event.inventory) == true) {
                plugin.server.scheduler.runTask(plugin, Runnable {
                    if (player.isOnline) resync(player)
                })
            }
        }
    }

    /**
     * Fermé sans ouvrir d'autre écran (ESC, `close_menu`) : la navigation est
     * finie, l'historique aussi — sinon un `open_menu` ultérieur empilerait un
     * menu déjà fermé et le retour le rouvrirait. Vérifié au tick suivant : ouvrir
     * B depuis A (ou un dialog) ferme aussi A, mais un autre écran est alors affiché.
     */
    private fun forgetNavigationIfClosed(player: Player) {
        val store = history ?: return
        val shown = store.current(player)?.takeIf { it.kind == NavigationEntry.Kind.MENU } ?: return
        plugin.server.scheduler.runTask(plugin, Runnable {
            if (store.current(player) !== shown) return@Runnable
            if (player.openInventory.topInventory?.holder is ArtisanMenuHolder) return@Runnable
            store.clear(player)
        })
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        windows?.clear(event.player.uniqueId)
        sessions.remove(event.player)
        history?.clear(event.player)
    }
}

private fun org.bukkit.event.inventory.ClickType.toIfzClickType(): ClickType? = when (this) {
    org.bukkit.event.inventory.ClickType.LEFT         -> ClickType.LEFT
    org.bukkit.event.inventory.ClickType.RIGHT        -> ClickType.RIGHT
    org.bukkit.event.inventory.ClickType.SHIFT_LEFT   -> ClickType.SHIFT_LEFT
    org.bukkit.event.inventory.ClickType.SHIFT_RIGHT  -> ClickType.SHIFT_RIGHT
    org.bukkit.event.inventory.ClickType.MIDDLE       -> ClickType.MIDDLE
    else                                               -> null
}
