package net.artisanmc.modules.api.gameevent;

import net.artisanmc.modules.api.annotations.Beta;

/** Two declarations for the same Game event name. */
@Beta
public final class DuplicateGameEventException extends IllegalStateException {
    public DuplicateGameEventException(String name) {
        super("game event '" + name + "' is already registered");
    }
}
