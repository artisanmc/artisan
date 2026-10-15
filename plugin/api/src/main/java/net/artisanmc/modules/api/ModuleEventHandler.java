package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/** Receives an event published on the {@link ModuleEventBus}. */
@Stable
@FunctionalInterface
public interface ModuleEventHandler {
    void onEvent(ModuleEvent event);
}
