package net.artisanmc.modules.api.stats;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * A measured event, declared once from {@code onEnable} with {@link StatsApi#declare}: its name,
 * how its records are stored, how its values read, who it is about, and the dimensions it is cut
 * by. Immutable; built with {@link #builder(String)}.
 *
 * <pre>{@code
 * api.getStats().declare(StatEvent.builder("quests:completed")
 *     .storage(StatStorage.BOTH)
 *     .dimensions("group", "quest")
 *     .value("duration_seconds")
 *     .build());
 * }</pre>
 */
@Beta
public final class StatEvent {
    /** {@code <namespace>:<name>}: lower case, digits, {@code _}; {@code .} also in the name. 64 characters at most. */
    public static final Pattern NAME = Pattern.compile("[a-z][a-z0-9_]{0,23}:[a-z][a-z0-9_.]{0,39}");
    /** A dimension or value name: lower case, digits, {@code _}, 32 characters at most. */
    public static final Pattern FIELD = Pattern.compile("[a-z][a-z0-9_]{0,31}");
    /** Dimensions per event, at most: each one multiplies the rows of a bucket. */
    public static final int MAX_DIMENSIONS = 6;

    private final String name;
    private final StatStorage storage;
    private final StatKind kind;
    private final StatScope scope;
    private final List<String> dimensions;
    private final @Nullable String valueName;
    private final int rawRetentionDays;

    private StatEvent(Builder b) {
        this.name = b.name;
        this.storage = b.storage;
        this.kind = b.kind;
        this.scope = b.scope;
        this.dimensions = List.copyOf(b.dimensions);
        this.valueName = b.valueName;
        this.rawRetentionDays = b.rawRetentionDays;
    }

    /**
     * Starts a declaration of {@code name}: by default {@link StatStorage#BUCKETED},
     * {@link StatKind#COUNTER}, {@link StatScope#PLAYER}, no dimension, no value.
     *
     * @throws IllegalArgumentException if {@code name} does not match {@link #NAME}
     */
    public static Builder builder(String name) {
        return new Builder(name);
    }

    public String getName() {
        return name;
    }

    /** The part before {@code :}, the namespace of the module that declared it. */
    public String getNamespace() {
        return name.substring(0, name.indexOf(':'));
    }

    public StatStorage getStorage() {
        return storage;
    }

    public StatKind getKind() {
        return kind;
    }

    public StatScope getScope() {
        return scope;
    }

    /** The dimension names, in declaration order. */
    public List<String> getDimensions() {
        return dimensions;
    }

    /** What a record's value measures ({@code duration_seconds}); null when a record only counts. */
    public @Nullable String getValueName() {
        return valueName;
    }

    /** Days a raw row is kept; 0 for the server's {@code stats.retention.raw-days}. */
    public int getRawRetentionDays() {
        return rawRetentionDays;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof StatEvent other)) return false;
        return name.equals(other.name) && storage == other.storage && kind == other.kind && scope == other.scope
            && dimensions.equals(other.dimensions) && Objects.equals(valueName, other.valueName)
            && rawRetentionDays == other.rawRetentionDays;
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, storage, kind, scope, dimensions, valueName, rawRetentionDays);
    }

    @Override
    public String toString() {
        return "StatEvent(" + name + ", " + storage + ", " + kind + ", " + scope + ", " + dimensions
            + (valueName == null ? "" : ", value=" + valueName) + ")";
    }

    /** Builds a {@link StatEvent}; every setter checks its argument. */
    @Beta
    public static final class Builder {
        private final String name;
        private StatStorage storage = StatStorage.BUCKETED;
        private StatKind kind = StatKind.COUNTER;
        private StatScope scope = StatScope.PLAYER;
        private final List<String> dimensions = new ArrayList<>();
        private @Nullable String valueName;
        private int rawRetentionDays;

        private Builder(String name) {
            Objects.requireNonNull(name, "name");
            if (!NAME.matcher(name).matches()) {
                throw new IllegalArgumentException("Stat event name '" + name + "': expected <namespace>:<name>, lower case");
            }
            this.name = name;
        }

        public Builder storage(StatStorage storage) {
            this.storage = Objects.requireNonNull(storage, "storage");
            return this;
        }

        public Builder kind(StatKind kind) {
            this.kind = Objects.requireNonNull(kind, "kind");
            return this;
        }

        public Builder scope(StatScope scope) {
            this.scope = Objects.requireNonNull(scope, "scope");
            return this;
        }

        /**
         * The dimension names, replacing any given before.
         *
         * @throws IllegalArgumentException a name not matching {@link #FIELD}, a duplicate, or more than {@link #MAX_DIMENSIONS}
         */
        public Builder dimensions(String... names) {
            LinkedHashSet<String> unique = new LinkedHashSet<>();
            for (String n : names) {
                Objects.requireNonNull(n, "dimension");
                if (!FIELD.matcher(n).matches()) throw new IllegalArgumentException("Dimension '" + n + "' of " + name + ": lower case, digits and _");
                if (!unique.add(n)) throw new IllegalArgumentException("Dimension '" + n + "' of " + name + " given twice");
            }
            if (unique.size() > MAX_DIMENSIONS) throw new IllegalArgumentException(name + ": " + MAX_DIMENSIONS + " dimensions at most");
            dimensions.clear();
            dimensions.addAll(unique);
            return this;
        }

        /** What a record's value measures; a record without one counts 1. */
        public Builder value(String valueName) {
            Objects.requireNonNull(valueName, "valueName");
            if (!FIELD.matcher(valueName).matches()) throw new IllegalArgumentException("Value '" + valueName + "' of " + name + ": lower case, digits and _");
            this.valueName = valueName;
            return this;
        }

        /** Days a raw row of this event is kept, instead of the server's default. */
        public Builder rawRetentionDays(int days) {
            if (days < 1) throw new IllegalArgumentException("Raw retention of " + name + ": one day at least");
            this.rawRetentionDays = days;
            return this;
        }

        public StatEvent build() {
            return new StatEvent(this);
        }
    }
}
