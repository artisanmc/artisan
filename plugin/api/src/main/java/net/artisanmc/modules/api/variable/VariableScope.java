package net.artisanmc.modules.api.variable;

import net.artisanmc.modules.api.annotations.Beta;

/** Whose value a module Variable holds (ADR {@code triggers-and-variables} §10). */
@Beta
public enum VariableScope {
    /** One value per player: the resolver answers for the player it is given. */
    PLAYER("player"),
    /**
     * One value for the server: the resolver ignores the player it is given. Since 1.3.0 that
     * player is null when the variable is read without one ({@code ConditionsApi.testWithoutPlayer}).
     */
    SERVER("server");

    private final String wire;

    VariableScope(String wire) {
        this.wire = wire;
    }

    /** The {@code scope} of a {@code declared_variables} entry. */
    public String wire() {
        return wire;
    }
}
