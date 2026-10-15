package net.artisanmc.modules.api;

import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/** A declared model document plus the module that owns it. */
@Beta
public final class DeclaredModel {
    private final String id;
    private final Map<String, Object> document;
    private final @Nullable String moduleId;

    public DeclaredModel(String id, Map<String, Object> document, @Nullable String moduleId) {
        this.id = Objects.requireNonNull(id, "id");
        this.document = Objects.requireNonNull(document, "document");
        this.moduleId = moduleId;
    }

    public String getId() {
        return id;
    }

    /** The model/v1 document, verbatim (may carry {@code version} + {@code migrations}). */
    public Map<String, Object> getDocument() {
        return document;
    }

    public @Nullable String getModuleId() {
        return moduleId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DeclaredModel other
            && id.equals(other.id) && document.equals(other.document) && Objects.equals(moduleId, other.moduleId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, document, moduleId);
    }

    @Override
    public String toString() {
        return "DeclaredModel(id=" + id + ", moduleId=" + moduleId + ")";
    }
}
