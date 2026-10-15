package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/** Marker for events published on the {@link ModuleEventBus}. Add-ons define their own events by implementing it. */
@Stable
public interface ModuleEvent {}
