package net.artisanmc.modules.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * A declared field: a name and a {@link ModelFieldType}, plus the presentation and validation
 * hints the editor's generated form reads (ADR {@code composable-data-models} §7). Immutable; the
 * {@code with*} methods return a copy.
 *
 * <p>Declared by a module for the arguments of an {@link ActionDeclaration}; the editor renders
 * the form from it and validates the value there (blocking in the form, tolerant at runtime).
 */
@Beta
public final class ModelField {
    private final String name;
    private final ModelFieldType type;
    private final boolean required;
    private final @Nullable Object defaultValue;
    private final @Nullable String label;
    private final @Nullable String help;

    public ModelField(String name, ModelFieldType type) {
        this(name, type, false, null, null, null);
    }

    public ModelField(String name, ModelFieldType type, boolean required) {
        this(name, type, required, null, null, null);
    }

    private ModelField(
        String name,
        ModelFieldType type,
        boolean required,
        @Nullable Object defaultValue,
        @Nullable String label,
        @Nullable String help
    ) {
        this.name = Objects.requireNonNull(name, "name");
        this.type = Objects.requireNonNull(type, "type");
        this.required = required;
        this.defaultValue = defaultValue;
        this.label = label;
        this.help = help;
    }

    public String getName() {
        return name;
    }

    public ModelFieldType getType() {
        return type;
    }

    public boolean isRequired() {
        return required;
    }

    /** Prefill for a fresh value; null = none. */
    public @Nullable Object getDefault() {
        return defaultValue;
    }

    /** Display label in the generated form; null = the field name. */
    public @Nullable String getLabel() {
        return label;
    }

    /** Help text shown as a tooltip; null = none. */
    public @Nullable String getHelp() {
        return help;
    }

    public ModelField withRequired(boolean required) {
        return new ModelField(name, type, required, defaultValue, label, help);
    }

    public ModelField withDefault(@Nullable Object value) {
        return new ModelField(name, type, required, value, label, help);
    }

    public ModelField withLabel(@Nullable String label) {
        return new ModelField(name, type, required, defaultValue, label, help);
    }

    public ModelField withHelp(@Nullable String help) {
        return new ModelField(name, type, required, defaultValue, label, help);
    }

    /** The editor's {@code ModelField} shape: {@code {name, type, required?, default?, label?, help?}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("type", type.toWire());
        if (required) out.put("required", true);
        if (defaultValue != null) out.put("default", defaultValue);
        if (label != null) out.put("label", label);
        if (help != null) out.put("help", help);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ModelField other
            && name.equals(other.name) && type.equals(other.type) && required == other.required
            && Objects.equals(defaultValue, other.defaultValue) && Objects.equals(label, other.label)
            && Objects.equals(help, other.help);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, required, defaultValue, label, help);
    }

    @Override
    public String toString() {
        return "ModelField(" + name + ": " + type.getKind() + ")";
    }
}
