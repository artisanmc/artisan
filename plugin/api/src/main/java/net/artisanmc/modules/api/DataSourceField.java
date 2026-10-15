package net.artisanmc.modules.api;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/** One declared row field: drives editor tooling (schema table, filter autocomplete). */
@Stable
public final class DataSourceField {
    private final String name;
    private final FieldKind type;
    private final @Nullable String description;

    public DataSourceField(String name, FieldKind type) {
        this(name, type, null);
    }

    public DataSourceField(String name, FieldKind type, @Nullable String description) {
        this.name = Objects.requireNonNull(name, "name");
        this.type = Objects.requireNonNull(type, "type");
        this.description = description;
    }

    public String getName() {
        return name;
    }

    public FieldKind getType() {
        return type;
    }

    public @Nullable String getDescription() {
        return description;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DataSourceField other
            && name.equals(other.name) && type == other.type && Objects.equals(description, other.description);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, description);
    }

    @Override
    public String toString() {
        return "DataSourceField(name=" + name + ", type=" + type + ", description=" + description + ")";
    }
}
