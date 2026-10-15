package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

@Stable
public class UnknownCommandException extends RuntimeException {
    public UnknownCommandException(String name) {
        super("No command registered with name '" + name + "'");
    }
}
