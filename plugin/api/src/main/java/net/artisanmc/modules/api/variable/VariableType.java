package net.artisanmc.modules.api.variable;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * The type of a module Variable's value (ADR {@code triggers-and-variables} §10): what the editor
 * offers to compare it with, and what a resolver must return. A value of another type is read as
 * absent.
 */
@Beta
public enum VariableType {
    /** A {@link String}. */
    STRING("string"),
    /** A {@link Number}, read as a double. */
    NUMBER("number"),
    /** A {@link Boolean}. */
    BOOLEAN("boolean");

    private final String wire;

    VariableType(String wire) {
        this.wire = wire;
    }

    /** The {@code type} of a {@code declared_variables} entry. */
    public String wire() {
        return wire;
    }

    /** True when {@code value} is of this type. */
    public boolean accepts(Object value) {
        return switch (this) {
            case STRING -> value instanceof String;
            case NUMBER -> value instanceof Number;
            case BOOLEAN -> value instanceof Boolean;
        };
    }
}
