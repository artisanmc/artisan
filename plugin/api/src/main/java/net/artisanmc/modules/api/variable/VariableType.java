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
    BOOLEAN("boolean"),
    /**
     * A place in a world: a {@link java.util.Map} with a {@code world} name and numeric {@code x},
     * {@code y}, {@code z} (optional {@code yaw}, {@code pitch}). Since 2.25.0.
     */
    LOCATION("location");

    private final String wire;

    VariableType(String wire) {
        this.wire = wire;
    }

    /** The type spelled {@code wire} ({@code string}, {@code number}...), or null. */
    public static @org.jetbrains.annotations.Nullable VariableType fromWire(String wire) {
        for (VariableType t : values()) {
            if (t.wire.equals(wire)) return t;
        }
        return null;
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
            case LOCATION -> value instanceof java.util.Map<?, ?> m
                && m.get("world") instanceof String
                && m.get("x") instanceof Number && m.get("y") instanceof Number && m.get("z") instanceof Number;
        };
    }
}
