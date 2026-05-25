package gg.interfaze.modules.menus

import gg.interfaze.modules.api.InterfazeAPI
import gg.interfaze.modules.api.InterfazeModule

/**
 * First Interfaze module — encapsulates the existing menu rendering pipeline:
 * - SyncedMenuProvider (WS sync, pack loading)
 * - MenuListener (Bukkit InventoryClickEvent)
 * - TitleCompiler, AssetCatalog
 *
 * V1 scope: this module is a thin wrapper. The existing classes are kept in
 * gg.interfaze.plugin.* and instantiated inside [onEnable]. Phase B5 moves
 * the relevant classes physically under modules/menus/.
 */
class MenusModule : InterfazeModule {
    override val id = "menus"
    override val schemaVersion = "menu/v1"

    private var api: InterfazeAPI? = null

    override fun onEnable(api: InterfazeAPI) {
        this.api = api
        // Wiring happens in InterfazePlugin for V1 — see migration note in onEnable docstring.
        // This keeps the patch surface minimal: existing instantiation order is preserved.
    }

    override fun onDisable() {
        // Provider shutdown is handled by InterfazePlugin.onDisable for V1.
    }

    override fun onReload() {
        // Hot-reload trigger forwarded via api.events in Phase H.
    }
}
