package net.artisanmc.modules.api.model;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.annotations.Sunset;
import net.artisanmc.modules.api.datasource.DataSourceRegistry;
import org.jetbrains.annotations.Nullable;

/**
 * Module-declared Data models ({@code api.models}, ADR {@code composable-data-models} §4): an
 * add-on declares the SHAPE of its config data as a {@link ModelDeclaration} (fields typed with
 * {@link ModelField} / {@link ModelFieldType}, the API's one field-type vocabulary); the plugin is
 * a pure passthrough. Its {@code model/v1} document is reported at Presence
 * ({@code hello.declared_models}) and consumed by the editor, which renders the schema-driven form.
 *
 * <p>Declared ids MUST be namespace-qualified ({@code boutique:category}). A declaration may carry
 * a monotonically increasing {@code version} plus declarative {@code migrations} steps, data
 * never code, applied editor-side.
 */
@Beta
public final class ModelRegistry implements OwnedRegistry {
    private final ConcurrentHashMap<String, DeclaredModel> models = new ConcurrentHashMap<>();

    /** Owner captured for declarations happening right now (cf. {@link DataSourceRegistry}). */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    @Internal
    @Override
    public void unregisterOwnedBy(String moduleId) {
        models.values().removeIf(m -> moduleId.equals(m.getModuleId()));
    }

    /** Declares {@code model}; its id must be unused ({@link DuplicateModelException}). */
    @Beta
    public void declare(ModelDeclaration model) {
        store(model.getId(), model.toWire());
    }

    /** Same as {@code declare(new ModelDeclaration(id, keyField, fields))}. */
    @Beta
    public void declare(String id, String keyField, List<ModelField> fields) {
        declare(new ModelDeclaration(id, keyField, fields));
    }

    /**
     * Declares a raw {@code model/v1} {@code document}, kept verbatim; its {@code id} must be
     * namespaced and unused ({@link DuplicateModelException}).
     */
    @Beta
    @Sunset(reason = "Untyped: a Data model is declared with ModelField / ModelFieldType like everything else",
        removeInVersion = "3.0.0", replacement = "declare(ModelDeclaration)")
    public void declare(Map<String, Object> document) {
        Object rawId = document.get("id");
        if (!(rawId instanceof String id)) throw new IllegalArgumentException("declared model document requires an 'id'");
        if (!id.contains(":")) {
            throw new IllegalArgumentException("declared model id must be namespaced (namespace:model): '" + id + "'");
        }
        store(id, document);
    }

    private void store(String id, Map<String, Object> document) {
        if (models.putIfAbsent(id, new DeclaredModel(id, document, currentOwner)) != null) {
            throw new DuplicateModelException(id);
        }
    }

    @Beta
    public boolean has(String id) {
        return models.containsKey(id);
    }

    /** All declared models, sorted by id (deterministic presence payload). */
    @Beta
    public List<DeclaredModel> declared() {
        return models.values().stream().sorted(Comparator.comparing(DeclaredModel::getId)).toList();
    }
}
