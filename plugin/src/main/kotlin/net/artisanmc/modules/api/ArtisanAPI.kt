package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.schemas.SchemaRegistry
import org.bukkit.plugin.java.JavaPlugin

/**
 * Facade passed to every module at `onEnable(api)`. Exposes:
 * - the [plugin] handle (for Bukkit scheduler, server, dataFolder)
 * - the cross-module registries ([dataSources], [commands])
 * - the [events] bus for hot-reload propagation
 * - the [schemas] registry for versioned data migrations
 * - the [modules] runtime registry for dynamic module registration
 *
 * Modules MUST go through this facade — direct access to the plugin internals
 * is allowed only inside the module's own package.
 *
 * Obtain via Bukkit `ServicesManager`:
 * `server.servicesManager.getRegistration(ArtisanAPI::class.java)?.provider`.
 */
@Stable
class ArtisanAPI(
    @Stable val plugin: JavaPlugin,
    @Stable val dataSources: DataSourceRegistry,
    @Stable val commands: CommandRegistry,
    @Stable val events: ModuleEventBus,
    @Stable val schemas: SchemaRegistry<MutableMap<String, Any?>>,
    @Stable val modules: ModuleRegistry,
    @Stable val coreVersion: String,
    @Stable val project: ProjectContentApi,
    @net.artisanmc.modules.api.annotations.Beta val items: ItemStackApi = ItemStackApi.NOOP,
    @net.artisanmc.modules.api.annotations.Beta val messages: ModuleMessagesApi = ModuleMessagesApi.NOOP,
) {
    /**
     * Returns true if this core version satisfies the module's declared minimum
     * (same major, core >= min).
     */
    @Stable
    fun isCompatibleWith(minVersion: String): Boolean = SemVer.satisfies(coreVersion, minVersion)
}
