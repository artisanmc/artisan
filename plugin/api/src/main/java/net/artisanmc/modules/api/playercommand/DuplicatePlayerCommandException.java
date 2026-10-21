package net.artisanmc.modules.api.playercommand;

import net.artisanmc.modules.api.annotations.Beta;

/** A player command id registered twice. */
@Beta
public final class DuplicatePlayerCommandException extends IllegalStateException {
    public DuplicatePlayerCommandException(String id) {
        super("player command '" + id + "' is already registered");
    }
}
