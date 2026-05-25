package gg.interfaze.modules.api

import gg.interfaze.modules.api.annotations.Stable

/**
 * Contract implemented by every Interfaze module (menus, commands, future shop/quests/...).
 *
 * Each module lives in `gg.interfaze.modules.{id}/` and is statically registered
 * in [gg.interfaze.plugin.InterfazePlugin.onEnable]. Modules communicate exclusively
 * via [InterfazeAPI] — never via direct dependencies on each other.
 */
@Stable
interface InterfazeModule {
    /** Module id, lowercase, e.g. "menus", "commands", "shop". Used in data source refs. */
    @Stable
    val id: String

    /** Schema version this module currently understands, e.g. "menu/v1". */
    @Stable
    val schemaVersion: String

    /** Called once at plugin enable, after the API facade is built. */
    @Stable
    fun onEnable(api: InterfazeAPI)

    /** Called on plugin disable. Modules must release listeners, executors, threads. */
    @Stable
    fun onDisable()

    /** Called when the menu cache is reloaded from disk (e.g. WS bundle update). */
    @Stable
    fun onReload() {}
}
