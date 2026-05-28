package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin

/**
 * Facade passed to every module at `onEnable(api)`. Exposes:
 * - the [plugin] handle (for Bukkit scheduler, server, dataFolder)
 * - the cross-module registries ([dataSources], [commands])
 * - the [events] bus for hot-reload propagation
 * - the [schemas] registry for versioned data migrations
 *
 * Modules MUST go through this facade — direct access to the plugin internals
 * is allowed only inside the module's own package.
 */
@Stable
class ArtisanAPI(
    @Stable val plugin: ArtisanPlugin,
    @Stable val dataSources: DataSourceRegistry,
    @Stable val commands: CommandRegistry,
    @Stable val events: ModuleEventBus,
    @Stable val schemas: SchemaRegistry<MutableMap<String, Any?>>,
)
