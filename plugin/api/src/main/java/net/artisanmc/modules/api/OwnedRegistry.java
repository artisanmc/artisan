package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * A registry that records which module made each registration, so that {@link ModuleRegistry}
 * can scope a module's {@code onEnable} and undo it on unregister. Implemented by the data
 * source, command, model, screen, action and document-kind registries; only
 * {@link ModuleRegistry} calls it. Not for add-ons.
 */
@Internal
public interface OwnedRegistry {
    /**
     * Owner given to the registrations made from now on: the module whose {@code onEnable} is
     * running (main-thread sequential), null for direct registrations (third-party plugins via
     * ServicesManager).
     */
    void bindOwner(@Nullable String moduleId);

    /** Removes what {@code moduleId} registered. */
    void unregisterOwnedBy(String moduleId);

    /** Removes the registrations whose callback {@code loader} loaded; nothing by default. */
    default void unregisterLoadedBy(ClassLoader loader) {}
}
