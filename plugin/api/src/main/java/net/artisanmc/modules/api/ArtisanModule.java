package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * Contract implemented by every Artisan module (menus, commands, an add-on's shop or quests).
 *
 * <p>Modules communicate exclusively through {@link ArtisanAPI}, never through direct
 * dependencies on each other. A module registers itself with {@link ModuleRegistry#register}.
 */
@Stable
public interface ArtisanModule {
    /** Module id, lowercase, e.g. {@code "menus"}, {@code "shop"}. Used in data source refs. */
    @Stable
    String getId();

    /** Schema version this module currently understands, e.g. {@code "menu/v1"}. */
    @Stable
    String getSchemaVersion();

    /** Called once at registration, after the API facade is built. */
    @Stable
    void onEnable(ArtisanAPI api);

    /**
     * Called when the module is unregistered: when the plugin that loaded it starts
     * disabling (before that plugin's own {@code onDisable}), on {@link ModuleRegistry#unregister},
     * or when Artisan disables. Modules must release listeners, executors, threads.
     */
    @Stable
    void onDisable();

    /** Called when the projects are reloaded from disk (publish, {@code /artisan reload}, sync). */
    @Stable
    default void onReload() {}
}
