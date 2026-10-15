package net.artisanmc.modules.menus

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule

/**
 * The menu rendering pipeline as a module:
 * - SyncedMenuProvider (project loading)
 * - MenuListener (Bukkit InventoryClickEvent)
 * - TitleCompiler, AssetCatalog
 *
 * A thin wrapper: those classes live in net.artisanmc.plugin.* and are wired by
 * ArtisanPlugin, which also handles their reload and shutdown.
 */
class MenusModule : ArtisanModule {
    override fun getId() = "menus"
    override fun getSchemaVersion() = "menu/v1"

    private var api: ArtisanAPI? = null

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
    }

    override fun onDisable() {
    }

    override fun onReload() {
    }
}
