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
 * - the [projectRoots] registry for Add-on-owned project directories
 * - the [database] lent to the plugins of the suite (one pool per plugin)
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
    /** The Artisan plugin version (`plugin.yml`, `1.0.<build>`). Not the API version: see [apiVersion]. */
    @Stable val coreVersion: String,
    @Stable val project: ProjectContentApi,
    @Stable val projectRoots: ProjectRootRegistry = ProjectRootRegistry.NOOP,
    @net.artisanmc.modules.api.annotations.Beta val items: ItemStackApi = ItemStackApi.NOOP,
    @net.artisanmc.modules.api.annotations.Sunset(
        reason = "No receiver since the editor moved into the plugin", removeInVersion = "2.0.0",
    )
    @net.artisanmc.modules.api.annotations.Beta val messages: ModuleMessagesApi = ModuleMessagesApi.NOOP,
    @net.artisanmc.modules.api.annotations.Beta val actions: ModuleActionsApi = ModuleActionsApi.NOOP,
    /** Module-declared Data models — model/v1 passthrough to Presence (ADR composable-data-models). */
    @net.artisanmc.modules.api.annotations.Beta val models: ModelRegistry = ModelRegistry(),
    /** Module-declared Config screens — reported at Presence (ADR module-config-screens). */
    @net.artisanmc.modules.api.annotations.Beta val screens: EditorScreenRegistry = EditorScreenRegistry(),
    /** One connection pool per plugin, credentials in `environment.yml` (ADR suite-foundation-database). */
    @net.artisanmc.modules.api.annotations.Beta val database: DatabaseApi = DatabaseApi.NONE,
) {
    /** Version of this API (the `Since` numbering of the published `artisan-core-api`). Since 1.8.0. */
    @Stable
    val apiVersion: String get() = ApiVersion.CURRENT

    /**
     * True if the running API satisfies the add-on's minimum API version
     * (same major, [apiVersion] >= min). Compared against [coreVersion] before 1.8.0.
     */
    @Stable
    fun isCompatibleWith(minVersion: String): Boolean = SemVer.satisfies(apiVersion, minVersion)
}
