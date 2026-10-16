package net.artisanmc.modules.api.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;

/** One variant of a {@link ModelFieldType#union} field: the tag value and the fields it carries. */
@Beta
public final class UnionVariant {
    private final String name;
    private final List<ModelField> fields;

    public UnionVariant(String name, List<ModelField> fields) {
        this.name = Objects.requireNonNull(name, "name");
        this.fields = List.copyOf(Objects.requireNonNull(fields, "fields"));
    }

    /** The tag value selecting this variant. */
    public String getName() {
        return name;
    }

    public List<ModelField> getFields() {
        return fields;
    }

    /** The editor's shape: {@code {name, fields: [...]}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("fields", fields.stream().map(ModelField::toWire).toList());
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof UnionVariant other && name.equals(other.name) && fields.equals(other.fields);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, fields);
    }

    @Override
    public String toString() {
        return "UnionVariant(" + name + ")";
    }
}
