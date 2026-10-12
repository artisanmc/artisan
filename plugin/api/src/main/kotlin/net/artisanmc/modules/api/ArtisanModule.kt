package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable

/**
 * Contract implemented by every Artisan module (menus, commands, future shop/quests/...).
 *
 * Each module lives in `net.artisanmc.modules.{id}/` and is statically registered
 * in [net.artisanmc.plugin.ArtisanPlugin.onEnable]. Modules communicate exclusively
 * via [ArtisanAPI] — never via direct dependencies on each other.
 */
@Stable
interface ArtisanModule {
    /** Module id, lowercase, e.g. "menus", "commands", "shop". Used in data source refs. */
    @Stable
    val id: String

    /** Schema version this module currently understands, e.g. "menu/v1". */
    @Stable
    val schemaVersion: String

    /** Called once at plugin enable, after the API facade is built. */
    @Stable
    fun onEnable(api: ArtisanAPI)

    /** Called on plugin disable. Modules must release listeners, executors, threads. */
    @Stable
    fun onDisable()

    /** Called when the menu cache is reloaded from disk (e.g. WS bundle update). */
    @Stable
    fun onReload() {}
}
