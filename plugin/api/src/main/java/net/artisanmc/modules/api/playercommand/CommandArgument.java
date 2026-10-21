package net.artisanmc.modules.api.playercommand;

import java.util.List;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * A positional argument of a {@link PlayerCommandDeclaration}. Artisan parses it, completes it and
 * refuses an invalid value with a message in the sender's language; the executor reads the typed
 * value from {@link PlayerCommandContext}.
 */
@Beta
public final class CommandArgument {
    /** The value an argument takes. */
    @Beta
    public enum Type {
        /** One word. */
        STRING,
        /** The rest of the line; only as the last argument. */
        TEXT,
        INT,
        /** An online player, as a {@code Player}. */
        PLAYER,
        /** A loaded world, as a {@code World}. */
        WORLD,
        /** One of {@link #getValues()}, as written there. */
        ENUM,
    }

    private final String name;
    private final Type type;
    private final boolean required;
    private final List<String> values;
    private final @Nullable SuggestionProvider suggestions;

    private CommandArgument(String name, Type type, boolean required, List<String> values, @Nullable SuggestionProvider suggestions) {
        if (name.isBlank()) throw new IllegalArgumentException("argument name is blank");
        this.name = name;
        this.type = Objects.requireNonNull(type, "type");
        this.required = required;
        this.values = List.copyOf(values);
        this.suggestions = suggestions;
    }

    private CommandArgument(String name, Type type, boolean required, List<String> values) {
        this(name, type, required, values, null);
    }

    public static CommandArgument string(String name) { return new CommandArgument(name, Type.STRING, true, List.of()); }
    public static CommandArgument text(String name) { return new CommandArgument(name, Type.TEXT, true, List.of()); }
    public static CommandArgument integer(String name) { return new CommandArgument(name, Type.INT, true, List.of()); }
    public static CommandArgument player(String name) { return new CommandArgument(name, Type.PLAYER, true, List.of()); }
    public static CommandArgument world(String name) { return new CommandArgument(name, Type.WORLD, true, List.of()); }

    public static CommandArgument choice(String name, List<String> values) {
        if (values.isEmpty()) throw new IllegalArgumentException("argument '" + name + "' has no value to choose from");
        return new CommandArgument(name, Type.ENUM, true, values);
    }

    /** The same argument, which the sender may leave out (the following ones must be optional too). */
    public CommandArgument optional() {
        return new CommandArgument(name, type, false, values, suggestions);
    }

    /**
     * The same argument, completed with what {@code provider} returns when the sender completes it,
     * in place of Artisan's own completion (online players for {@link Type#PLAYER}, worlds for
     * {@link Type#WORLD}). Parsing is unchanged: a {@code STRING} accepts any word, a suggested one
     * or not. Not on an {@link Type#ENUM} argument, whose values are fixed.
     *
     * @throws IllegalStateException on an {@link Type#ENUM} argument
     * @since 2.14.0
     */
    public CommandArgument suggestions(SuggestionProvider provider) {
        Objects.requireNonNull(provider, "provider");
        if (type == Type.ENUM) throw new IllegalStateException("argument '" + name + "' is a choice: its values are fixed");
        return new CommandArgument(name, type, required, values, provider);
    }

    public String getName() { return name; }
    public Type getType() { return type; }
    public boolean isRequired() { return required; }
    /** The accepted values of an {@link Type#ENUM} argument, empty otherwise. */
    public List<String> getValues() { return values; }
    /** What {@link #suggestions(SuggestionProvider)} set; null: Artisan's own completion. @since 2.14.0 */
    public @Nullable SuggestionProvider getSuggestions() { return suggestions; }

    @Override
    public boolean equals(Object o) {
        return o instanceof CommandArgument other && name.equals(other.name) && type == other.type
            && required == other.required && values.equals(other.values) && suggestions == other.suggestions;
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, required, values, suggestions);
    }

    @Override
    public String toString() {
        return "CommandArgument(" + name + ": " + type + (required ? "" : "?") + ")";
    }
}
