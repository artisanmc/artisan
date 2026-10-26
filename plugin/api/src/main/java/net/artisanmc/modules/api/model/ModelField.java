package net.artisanmc.modules.api.model;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.action.ActionDeclaration;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * A declared field: a name and a {@link ModelFieldType}, plus the presentation and validation
 * hints the editor's generated form reads (ADR {@code composable-data-models} §7, the
 * {@code model/v1} {@code Field}). Immutable; the {@code with*} methods return a copy.
 *
 * <p>Declared by a module for the arguments of an {@link ActionDeclaration} and for the fields of
 * a Data model ({@link ModelDeclaration}); the editor renders the form from it and validates the
 * value there (blocking in the form, tolerant at runtime).
 */
@Stable
public final class ModelField {
    private final String name;
    private final ModelFieldType type;
    private final boolean required;
    private final @Nullable Object defaultValue;
    private final @Nullable String label;
    private final @Nullable String help;
    private final @Nullable String section;
    private final @Nullable Double min;
    private final @Nullable Double max;
    private final @Nullable String pattern;
    private final boolean locked;

    public ModelField(String name, ModelFieldType type) {
        this(name, type, false, null, null, null, null, null, null, null, false);
    }

    public ModelField(String name, ModelFieldType type, boolean required) {
        this(name, type, required, null, null, null, null, null, null, null, false);
    }

    private ModelField(
        String name,
        ModelFieldType type,
        boolean required,
        @Nullable Object defaultValue,
        @Nullable String label,
        @Nullable String help,
        @Nullable String section,
        @Nullable Double min,
        @Nullable Double max,
        @Nullable String pattern,
        boolean locked
    ) {
        this.name = Objects.requireNonNull(name, "name");
        this.type = Objects.requireNonNull(type, "type");
        this.required = required;
        this.defaultValue = defaultValue;
        this.label = label;
        this.help = help;
        this.section = section;
        this.min = min;
        this.max = max;
        this.pattern = pattern;
        this.locked = locked;
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

    /** Section header the field is grouped under in the generated form; null = none. */
    public @Nullable String getSection() {
        return section;
    }

    /** Lower bound of a {@code number} / {@code integer} value; null = none. */
    public @Nullable Double getMin() {
        return min;
    }

    /** Upper bound of a {@code number} / {@code integer} value; null = none. */
    public @Nullable Double getMax() {
        return max;
    }

    /** Regex a string value must match; null = none. */
    public @Nullable String getPattern() {
        return pattern;
    }

    /** The add-on manages this value itself: read-only in the generated form. */
    public boolean isLocked() {
        return locked;
    }

    public ModelField withRequired(boolean required) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    public ModelField withDefault(@Nullable Object value) {
        return new ModelField(name, type, required, value, label, help, section, min, max, pattern, locked);
    }

    public ModelField withLabel(@Nullable String label) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    public ModelField withHelp(@Nullable String help) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    public ModelField withSection(@Nullable String section) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    /** Numeric bounds; either may be null (no bound on that side). */
    public ModelField withRange(@Nullable Double min, @Nullable Double max) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    public ModelField withPattern(@Nullable String pattern) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    public ModelField withLocked(boolean locked) {
        return new ModelField(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    /**
     * The editor's {@code ModelField} shape: {@code {name, type, required?, default?, label?, help?,
     * section?, min?, max?, pattern?, locked?}}.
     */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("type", type.toWire());
        if (required) out.put("required", true);
        if (defaultValue != null) out.put("default", defaultValue);
        if (label != null) out.put("label", label);
        if (help != null) out.put("help", help);
        if (section != null) out.put("section", section);
        if (min != null) out.put("min", min);
        if (max != null) out.put("max", max);
        if (pattern != null) out.put("pattern", pattern);
        if (locked) out.put("locked", true);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ModelField other
            && name.equals(other.name) && type.equals(other.type) && required == other.required
            && Objects.equals(defaultValue, other.defaultValue) && Objects.equals(label, other.label)
            && Objects.equals(help, other.help) && Objects.equals(section, other.section)
            && Objects.equals(min, other.min) && Objects.equals(max, other.max)
            && Objects.equals(pattern, other.pattern) && locked == other.locked;
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, required, defaultValue, label, help, section, min, max, pattern, locked);
    }

    @Override
    public String toString() {
        return "ModelField(" + name + ": " + type.getKind() + ")";
    }
}
