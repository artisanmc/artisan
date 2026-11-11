package net.artisanmc.modules.api.playercommand;

import net.artisanmc.modules.api.annotations.Stable;

/** A player command id registered twice. */
@Stable
public final class DuplicatePlayerCommandException extends IllegalStateException {
    public DuplicatePlayerCommandException(String id) {
        super("player command '" + id + "' is already registered");
    }
}
