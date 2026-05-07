package gg.interfaze.plugin.provider

import gg.interfaze.plugin.engine.ExecutionContext
import gg.interfaze.plugin.model.BundleDialog
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.PackBundle
import org.bukkit.entity.Player

interface MenuProvider {
    fun load()
    fun unload() {}
    fun findMenu(menuId: String): BundleMenu?
    fun listMenuIds(): List<String> = emptyList()
    fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext)
    fun openMenu(player: Player, menuId: String, lang: String) =
        openMenu(player, menuId, lang, ExecutionContext(player))
    fun allBundles(): List<PackBundle> = emptyList()
    fun findDialog(dialogId: String): BundleDialog? = null
    fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
    fun requestEditorSession(sender: String, onReady: (url: String, expiresAt: String) -> Unit) {}
    fun revokeEditorSessions() {}
}
