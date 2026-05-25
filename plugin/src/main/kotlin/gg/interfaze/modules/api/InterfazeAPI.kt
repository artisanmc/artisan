package gg.interfaze.modules.api

import gg.interfaze.plugin.InterfazePlugin

/**
 * Facade passed to every module at `onEnable(api)`. Exposes:
 * - the [plugin] handle (for Bukkit scheduler, server, dataFolder)
 * - the cross-module registries ([dataSources], [commands])
 * - the [events] bus for hot-reload propagation
 *
 * Modules MUST go through this facade — direct access to the plugin internals
 * is allowed only inside the module's own package.
 */
class InterfazeAPI(
    val plugin: InterfazePlugin,
    val dataSources: DataSourceRegistry,
    val commands: CommandRegistry,
    val events: ModuleEventBus,
)
