package net.artisanmc.modules.api;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;

/** A command a module exposes: its {@code namespace:name} and the handler that runs it. */
@Stable
public final class CommandDeclaration {
    private final String name;
    private final CommandHandler handler;

    public CommandDeclaration(String name, CommandHandler handler) {
        this.name = Objects.requireNonNull(name, "name");
        this.handler = Objects.requireNonNull(handler, "handler");
    }

    public String getName() {
        return name;
    }

    public CommandHandler getHandler() {
        return handler;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof CommandDeclaration other && name.equals(other.name) && handler.equals(other.handler);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, handler);
    }

    @Override
    public String toString() {
        return "CommandDeclaration(name=" + name + ")";
    }
}
