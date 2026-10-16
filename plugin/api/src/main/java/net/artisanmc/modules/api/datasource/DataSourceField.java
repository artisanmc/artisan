package net.artisanmc.modules.api.datasource;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.annotations.Sunset;
import net.artisanmc.modules.api.model.ModelFieldType;
import org.jetbrains.annotations.Nullable;

/**
 * One declared row field: drives editor tooling (schema table, filter autocomplete).
 *
 * <p>Its type is a {@link ModelFieldType} since 2.0.0, the vocabulary Data models and Action
 * arguments use. The {@code data_sources} wire reports its {@link ModelFieldType#getKind() kind}.
 */
@Stable
public final class DataSourceField {
    private final String name;
    private final ModelFieldType fieldType;
    private final @Nullable String description;

    public DataSourceField(String name, ModelFieldType type) {
        this(name, type, null);
    }

    public DataSourceField(String name, ModelFieldType type, @Nullable String description) {
        this.name = Objects.requireNonNull(name, "name");
        this.fieldType = Objects.requireNonNull(type, "type");
        this.description = description;
    }

    /** Same as {@code new DataSourceField(name, type.toModelFieldType())}. */
    @Sunset(reason = "FieldKind is replaced by ModelFieldType", removeInVersion = "3.0.0",
        replacement = "DataSourceField(String, ModelFieldType)")
    public DataSourceField(String name, FieldKind type) {
        this(name, Objects.requireNonNull(type, "type").toModelFieldType(), null);
    }

    /** Same as {@code new DataSourceField(name, type.toModelFieldType(), description)}. */
    @Sunset(reason = "FieldKind is replaced by ModelFieldType", removeInVersion = "3.0.0",
        replacement = "DataSourceField(String, ModelFieldType, String)")
    public DataSourceField(String name, FieldKind type, @Nullable String description) {
        this(name, Objects.requireNonNull(type, "type").toModelFieldType(), description);
    }

    public String getName() {
        return name;
    }

    /** The field's type. */
    public ModelFieldType getFieldType() {
        return fieldType;
    }

    /** The closest {@link FieldKind} of {@link #getFieldType()} ({@link FieldKind#closestTo}). */
    @Sunset(reason = "FieldKind is replaced by ModelFieldType", removeInVersion = "3.0.0",
        replacement = "getFieldType()")
    public FieldKind getType() {
        return FieldKind.closestTo(fieldType);
    }

    public @Nullable String getDescription() {
        return description;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DataSourceField other
            && name.equals(other.name) && fieldType.equals(other.fieldType)
            && Objects.equals(description, other.description);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, fieldType, description);
    }

    @Override
    public String toString() {
        return "DataSourceField(name=" + name + ", type=" + fieldType.getKind() + ", description=" + description + ")";
    }
}
