package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player

/** A menu: its project folder and its id. `toString()` is the `project:menu` form the Action DSL takes. */
@Beta
data class MenuRef(val projectId: String?, val menuId: String) {
    override fun toString(): String = if (projectId.isNullOrEmpty()) menuId else "$projectId:$menuId"

    companion object {
        /** `shop:main`, or a bare `main` (no project). */
        @JvmStatic
        fun parse(ref: String): MenuRef {
            val at = ref.indexOf(':')
            if (at == -1) {
                require(ref.isNotBlank()) { "Empty menu ref" }
                return MenuRef(null, ref)
            }
            require(at > 0 && at < ref.length - 1) { "Malformed menu ref '$ref'" }
            return MenuRef(ref.substring(0, at), ref.substring(at + 1))
        }
    }
}

/**
 * Opens and watches Artisan menus (`api.menus`).
 *
 * Every method may be called from any thread. Opening and closing run on the
 * player's thread (their region's thread on Folia), scheduled if needed. Listeners
 * are called on the player's thread too; see [MenuOpenEvent], [MenuClickEvent],
 * [MenuCloseEvent], also fired as Bukkit events.
 */
@Beta
interface MenuApi {
    /**
     * Opens [menu] for [player], with [args] as the menu's context (like `open_menu … with`).
     * Returns false, opening nothing, when no menu matches.
     */
    fun open(player: Player, menu: MenuRef, args: Map<String, Any>): Boolean

    /** [ref] is `project:menu`, or a bare id looked up on the whole server. */
    fun open(player: Player, ref: String, args: Map<String, Any>): Boolean

    fun open(player: Player, ref: String): Boolean

    /** Closes the player's Artisan menu, if one is open. */
    fun close(player: Player)

    /** The Artisan menu the player has open, or null. */
    fun openMenu(player: Player): MenuRef?

    /** Every menu of every loaded project. */
    fun menus(): List<MenuRef>

    fun onOpen(listener: MenuOpenListener): MenuSubscription
    fun onClick(listener: MenuClickListener): MenuSubscription
    fun onClose(listener: MenuCloseListener): MenuSubscription

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: MenuApi = object : MenuApi {
            override fun open(player: Player, menu: MenuRef, args: Map<String, Any>) = false
            override fun open(player: Player, ref: String, args: Map<String, Any>) = false
            override fun open(player: Player, ref: String) = false
            override fun close(player: Player) {}
            override fun openMenu(player: Player): MenuRef? = null
            override fun menus(): List<MenuRef> = emptyList()
            override fun onOpen(listener: MenuOpenListener) = MenuSubscription {}
            override fun onClick(listener: MenuClickListener) = MenuSubscription {}
            override fun onClose(listener: MenuCloseListener) = MenuSubscription {}
        }
    }
}

@Beta
fun interface MenuOpenListener {
    fun onOpen(event: MenuOpenEvent)
}

@Beta
fun interface MenuClickListener {
    fun onClick(event: MenuClickEvent)
}

@Beta
fun interface MenuCloseListener {
    fun onClose(event: MenuCloseEvent)
}

/** Returned by the `MenuApi.on…` methods: [cancel] stops the listener. */
@Beta
fun interface MenuSubscription {
    fun cancel()
}
