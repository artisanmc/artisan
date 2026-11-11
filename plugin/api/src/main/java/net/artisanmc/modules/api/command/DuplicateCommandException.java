package net.artisanmc.modules.api.command;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class DuplicateCommandException extends IllegalStateException {
    public DuplicateCommandException(String name) {
        super("Command '" + name + "' is already registered");
    }
}
