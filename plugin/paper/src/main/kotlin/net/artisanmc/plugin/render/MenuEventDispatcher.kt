package net.artisanmc.plugin.render

import net.artisanmc.modules.api.menu.MenuClickEvent
import net.artisanmc.modules.api.menu.MenuClickListener
import net.artisanmc.modules.api.menu.MenuCloseEvent
import net.artisanmc.modules.api.menu.MenuCloseListener
import net.artisanmc.modules.api.menu.MenuOpenEvent
import net.artisanmc.modules.api.menu.MenuOpenListener
import net.artisanmc.modules.api.menu.MenuSubscription
import org.bukkit.Bukkit
import org.bukkit.event.Event
import java.util.concurrent.CopyOnWriteArrayList
import java.util.logging.Level
import java.util.logging.Logger

/** Delivers menu events to the `api.menus` listeners, then as Bukkit events. On the player's thread. */
class MenuEventDispatcher(private val logger: Logger) {
    private val opens = CopyOnWriteArrayList<MenuOpenListener>()
    private val clicks = CopyOnWriteArrayList<MenuClickListener>()
    private val closes = CopyOnWriteArrayList<MenuCloseListener>()

    fun onOpen(listener: MenuOpenListener) = subscribe(opens, listener)
    fun onClick(listener: MenuClickListener) = subscribe(clicks, listener)
    fun onClose(listener: MenuCloseListener) = subscribe(closes, listener)

    /** False if a listener cancelled the open. */
    fun open(event: MenuOpenEvent): Boolean {
        deliver(opens, event) { it.onOpen(event) }
        return !event.isCancelled
    }

    /** False if a listener cancelled the click's actions. */
    fun click(event: MenuClickEvent): Boolean {
        deliver(clicks, event) { it.onClick(event) }
        return !event.isCancelled
    }

    fun close(event: MenuCloseEvent) = deliver(closes, event) { it.onClose(event) }

    private fun <L> subscribe(list: MutableList<L>, listener: L): MenuSubscription {
        list.add(listener)
        return MenuSubscription { list.remove(listener) }
    }

    private fun <L> deliver(listeners: List<L>, event: Event, call: (L) -> Unit) {
        for (listener in listeners) {
            try {
                call(listener)
            } catch (e: Exception) {
                logger.log(Level.WARNING, "[Artisan] menu listener failed on ${event.eventName}", e)
            }
        }
        Bukkit.getPluginManager().callEvent(event)
    }
}
