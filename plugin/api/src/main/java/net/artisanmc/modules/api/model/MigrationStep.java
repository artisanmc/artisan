package net.artisanmc.modules.api.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * One declarative step of a {@link ModelMigration} (ADR {@code composable-data-models} §5): a
 * closed vocabulary of data transforms, never code, applied by the editor to the instances
 * written under an older version of a declared model. Built through the static factories;
 * {@link #toWire()} is the {@code model/v1} step shape ({@code {op, …}}).
 *
 * <p>{@code path} names the object fields leading from the instance root to the objects the step
 * applies to; lists and maps on the way fan out over their elements. Empty = the root.
 */
@Beta
public final class MigrationStep {
    private final Map<String, Object> wire;

    private MigrationStep(Map<String, Object> wire) {
        this.wire = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(wire));
    }

    private static MigrationStep of(String op, List<String> path, Object... keyValues) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("op", op);
        for (int i = 0; i < keyValues.length; i += 2) {
            if (keyValues[i + 1] != null) out.put((String) keyValues[i], keyValues[i + 1]);
        }
        if (!Objects.requireNonNull(path, "path").isEmpty()) out.put("path", List.copyOf(path));
        return new MigrationStep(out);
    }

    /** Renames the field {@code from} to {@code to}, at the root. */
    public static MigrationStep renameField(String from, String to) {
        return renameField(from, to, List.of());
    }

    public static MigrationStep renameField(String from, String to, List<String> path) {
        return of("rename_field", path, "from", Objects.requireNonNull(from, "from"), "to", Objects.requireNonNull(to, "to"));
    }

    /** Fills {@code field} with {@code value} where it is absent, at the root. */
    public static MigrationStep setDefault(String field, Object value) {
        return setDefault(field, value, List.of());
    }

    public static MigrationStep setDefault(String field, Object value, List<String> path) {
        return of("set_default", path, "field", Objects.requireNonNull(field, "field"), "value", Objects.requireNonNull(value, "value"));
    }

    /** Rewrites the {@code enum} value {@code from} of {@code field} to {@code to}, at the root. */
    public static MigrationStep renameEnumValue(String field, String from, String to) {
        return renameEnumValue(field, from, to, List.of());
    }

    public static MigrationStep renameEnumValue(String field, String from, String to, List<String> path) {
        return of("rename_enum_value", path, "field", Objects.requireNonNull(field, "field"),
            "from", Objects.requireNonNull(from, "from"), "to", Objects.requireNonNull(to, "to"));
    }

    /**
     * Renames the variant {@code from} of the {@code union} {@code field} to {@code to}, at the
     * root; {@code tag} is the union's tag field (null = the editor reads it from the model).
     */
    public static MigrationStep renameVariant(String field, @Nullable String tag, String from, String to) {
        return renameVariant(field, tag, from, to, List.of());
    }

    public static MigrationStep renameVariant(String field, @Nullable String tag, String from, String to, List<String> path) {
        return of("rename_variant", path, "field", Objects.requireNonNull(field, "field"), "tag", tag,
            "from", Objects.requireNonNull(from, "from"), "to", Objects.requireNonNull(to, "to"));
    }

    /** {@code rename_field}, {@code set_default}, {@code rename_enum_value} or {@code rename_variant}. */
    public String getOp() {
        return (String) wire.get("op");
    }

    /** The {@code model/v1} step: {@code {op, …the op's keys, path?}}. */
    public Map<String, Object> toWire() {
        return new LinkedHashMap<>(wire);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof MigrationStep other && wire.equals(other.wire);
    }

    @Override
    public int hashCode() {
        return wire.hashCode();
    }

    @Override
    public String toString() {
        return "MigrationStep(" + toWire() + ")";
    }
}
