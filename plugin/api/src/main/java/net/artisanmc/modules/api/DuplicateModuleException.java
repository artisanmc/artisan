package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/** Thrown when a module id is registered twice. */
@Stable
public class DuplicateModuleException extends IllegalArgumentException {
    public DuplicateModuleException(String id) {
        super("Module '" + id + "' is already registered");
    }
}
