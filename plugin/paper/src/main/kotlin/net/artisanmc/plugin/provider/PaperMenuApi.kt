package net.artisanmc.plugin.provider

import net.artisanmc.modules.api.menu.MenuApi
import net.artisanmc.modules.api.menu.MenuClickListener
import net.artisanmc.modules.api.menu.MenuCloseListener
import net.artisanmc.modules.api.menu.MenuOpenListener
import net.artisanmc.modules.api.menu.MenuRef
import net.artisanmc.modules.api.menu.MenuSubscription
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.MenuSessionStore
import net.artisanmc.plugin.render.MenuEventDispatcher
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.entity.Player

/** `api.menus`. The provider and sessions exist only once the plugin is enabled, hence the lookups. */
class PaperMenuApi(
    private val provider: () -> MenuProvider?,
    private val sessions: () -> MenuSessionStore?,
    private val langOf: (Player) -> String,
    private val scheduler: Scheduler,
    private val events: MenuEventDispatcher,
) : MenuApi {
    override fun open(player: Player, menu: MenuRef, args: Map<String, Any>) = open(player, menu.toString(), args)

    override fun open(player: Player, ref: String) = open(player, ref, emptyMap())

    override fun open(player: Player, ref: String, args: Map<String, Any>): Boolean {
        val menus = provider() ?: return false
        if (menus.findMenu(ref, null) == null) return false
        scheduler.onPlayer(player.uniqueId) {
            val lang = langOf(player)
            menus.openMenu(player, ref, lang, ExecutionContext(player, args = args, lang = lang))
        }
        return true
    }

    override fun close(player: Player) = scheduler.onPlayer(player.uniqueId) {
        if (sessions()?.get(player) != null) player.closeInventory()
    }

    override fun openMenu(player: Player): MenuRef? = sessions()?.get(player)?.ref

    override fun menus(): List<MenuRef> =
        provider()?.allBundles().orEmpty().flatMap { bundle ->
            bundle.menus.map { MenuRef(bundle.projectId.ifEmpty { null }, it.id) }
        }

    override fun onOpen(listener: MenuOpenListener): MenuSubscription = events.onOpen(listener)
    override fun onClick(listener: MenuClickListener): MenuSubscription = events.onClick(listener)
    override fun onClose(listener: MenuCloseListener): MenuSubscription = events.onClose(listener)
}
