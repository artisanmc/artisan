package net.artisanmc.plugin.provider

import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.engine.RuntimeProject
import org.bukkit.entity.Player

interface MenuProvider {
    fun load()
    /** Soft tear-down used by `/artisan reload` etc. — must leave the provider re-loadable. */
    fun unload() {}
    /** Hard tear-down used by `onDisable` — releases resources that cannot be reused. */
    fun shutdown() { unload() }
    fun findMenu(menuId: String): RuntimeMenu?
    /**
     * `ref` = bare id (looked up in [fromProject] first, then server-wide) or
     * `project:id`. The default ignores the project, for simple implementations.
     */
    fun findMenu(ref: String, fromProject: String?): RuntimeMenu? = findMenu(ref)
    fun listMenuIds(): List<String> = emptyList()
    fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext)
    fun openMenu(player: Player, menuId: String, lang: String) =
        openMenu(player, menuId, lang, ExecutionContext(player))
    fun runtimeProjects(): List<RuntimeProject> = emptyList()
    fun findDialog(dialogId: String): RuntimeDialog? = null
    fun findDialog(ref: String, fromProject: String?): RuntimeDialog? = findDialog(ref)
    fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
}
