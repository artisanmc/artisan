package net.artisanmc.modules.menus

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule

/**
 * First Artisan module — encapsulates the existing menu rendering pipeline:
 * - SyncedMenuProvider (WS sync, project loading)
 * - MenuListener (Bukkit InventoryClickEvent)
 * - TitleCompiler, AssetCatalog
 *
 * V1 scope: this module is a thin wrapper. The existing classes are kept in
 * net.artisanmc.plugin.* and instantiated inside [onEnable]. Phase B5 moves
 * the relevant classes physically under modules/menus/.
 */
class MenusModule : ArtisanModule {
    override val id = "menus"
    override val schemaVersion = "menu/v1"

    private var api: ArtisanAPI? = null

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
        // Wiring happens in ArtisanPlugin for V1 — see migration note in onEnable docstring.
        // This keeps the patch surface minimal: existing instantiation order is preserved.
    }

    override fun onDisable() {
        // Provider shutdown is handled by ArtisanPlugin.onDisable for V1.
    }

    override fun onReload() {
        // Hot-reload trigger forwarded via api.events in Phase H.
    }
}
