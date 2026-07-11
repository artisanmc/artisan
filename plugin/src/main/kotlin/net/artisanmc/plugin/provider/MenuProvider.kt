package net.artisanmc.plugin.provider

import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.BundleDialog
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import org.bukkit.entity.Player

interface MenuProvider {
    fun load()
    /** Soft tear-down used by `/artisan reload` etc. — must leave the provider re-loadable. */
    fun unload() {}
    /** Hard tear-down used by `onDisable` — releases resources that cannot be reused. */
    fun shutdown() { unload() }
    fun findMenu(menuId: String): BundleMenu?
    fun listMenuIds(): List<String> = emptyList()
    fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext)
    fun openMenu(player: Player, menuId: String, lang: String) =
        openMenu(player, menuId, lang, ExecutionContext(player))
    fun allBundles(): List<ProjectBundle> = emptyList()
    fun findDialog(dialogId: String): BundleDialog? = null
    fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
    /** (editorUrl, networkName) once known from hello_ack; null before the plugin has connected. */
    fun editorInfo(): Pair<String, String>? = null
    /**
     * Sends a `local_push` WS message for the given project dir so the backend can
     * ingest locally-edited files (FTP scenario). No-op when not connected.
     * Returns the hash included in the message, or null if the project dir was not found.
     */
    fun pushLocalProject(projectId: String, projectDir: java.io.File): String? = null
}
