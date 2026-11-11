package net.artisanmc.modules.api.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * A Data model an add-on declares ({@link ModelRegistry#declare(ModelDeclaration)}, ADR
 * {@code composable-data-models} §4/§5): a namespaced id, the Row key field, the fields, and the
 * optional display name, monotonic {@code version} with its declarative {@code migrations}, and
 * master-detail hint. Immutable; the {@code with*} methods return a copy. {@link #toWire()} is
 * the {@code model/v1} document reported at Presence.
 */
@Beta
public final class ModelDeclaration {
    private final String id;
    private final String keyField;
    private final List<ModelField> fields;
    private final @Nullable String name;
    private final @Nullable Integer version;
    private final List<ModelMigration> migrations;
    private final boolean masterDetail;

    /** {@code id} is namespaced ({@code boutique:category}); {@code keyField} names a top-level field. */
    public ModelDeclaration(String id, String keyField, List<ModelField> fields) {
        this(id, keyField, fields, null, null, List.of(), false);
    }

    private ModelDeclaration(
        String id,
        String keyField,
        List<ModelField> fields,
        @Nullable String name,
        @Nullable Integer version,
        List<ModelMigration> migrations,
        boolean masterDetail
    ) {
        this.id = Objects.requireNonNull(id, "id");
        if (!id.contains(":")) {
            throw new IllegalArgumentException("declared model id must be namespaced (namespace:model): '" + id + "'");
        }
        this.keyField = Objects.requireNonNull(keyField, "keyField");
        this.fields = List.copyOf(Objects.requireNonNull(fields, "fields"));
        this.name = name;
        this.version = version;
        this.migrations = List.copyOf(Objects.requireNonNull(migrations, "migrations"));
        if (!this.migrations.isEmpty() && version == null) {
            throw new IllegalArgumentException("model '" + id + "' declares migrations without a version");
        }
        for (ModelMigration m : this.migrations) {
            if (m.getTo() > version) {
                throw new IllegalArgumentException("model '" + id + "' migrates to " + m.getTo() + ", above its version " + version);
            }
        }
        this.masterDetail = masterDetail;
    }

    public String getId() {
        return id;
    }

    public String getKeyField() {
        return keyField;
    }

    public List<ModelField> getFields() {
        return fields;
    }

    /** Display name; null = the editor shows the id. */
    public @Nullable String getName() {
        return name;
    }

    /** Monotonic declaration version; null = unversioned. */
    public @Nullable Integer getVersion() {
        return version;
    }

    public List<ModelMigration> getMigrations() {
        return migrations;
    }

    /** Presentation hint: the model's Table renders as a row list beside the selected row's form. */
    public boolean isMasterDetail() {
        return masterDetail;
    }

    public ModelDeclaration withName(@Nullable String name) {
        return new ModelDeclaration(id, keyField, fields, name, version, migrations, masterDetail);
    }

    public ModelDeclaration withVersion(int version) {
        return new ModelDeclaration(id, keyField, fields, name, version, migrations, masterDetail);
    }

    /** The version and the migrations that lead to it from older ones (each {@code to <= version}). */
    public ModelDeclaration withVersion(int version, List<ModelMigration> migrations) {
        return new ModelDeclaration(id, keyField, fields, name, version, migrations, masterDetail);
    }

    public ModelDeclaration withMasterDetail(boolean masterDetail) {
        return new ModelDeclaration(id, keyField, fields, name, version, migrations, masterDetail);
    }

    /**
     * The {@code model/v1} document: {@code {schema, id, name?, key_field, fields, version?,
     * master_detail?, migrations?}}, fields in their verbatim {@code {name, type: {kind, …}}} form.
     */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("schema", "model/v1");
        out.put("id", id);
        if (name != null) out.put("name", name);
        out.put("key_field", keyField);
        out.put("fields", fields.stream().map(ModelField::toWire).toList());
        if (version != null) out.put("version", version);
        if (masterDetail) out.put("master_detail", true);
        if (!migrations.isEmpty()) out.put("migrations", migrations.stream().map(ModelMigration::toWire).toList());
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ModelDeclaration other
            && id.equals(other.id) && keyField.equals(other.keyField) && fields.equals(other.fields)
            && Objects.equals(name, other.name) && Objects.equals(version, other.version)
            && migrations.equals(other.migrations) && masterDetail == other.masterDetail;
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, keyField, fields, name, version, migrations, masterDetail);
    }

    @Override
    public String toString() {
        return "ModelDeclaration(" + id + ", " + fields.size() + " fields)";
    }
}
