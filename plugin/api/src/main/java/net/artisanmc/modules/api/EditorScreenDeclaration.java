package net.artisanmc.modules.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * A module-declared Config screen (ADR {@code module-config-screens}): a named entry in the
 * editor's sidebar whose core-generated form edits one declared-model Table/Config of the
 * module's owned project, live over the WS relay.
 */
@Beta
public final class EditorScreenDeclaration {
    private final String id;
    private final String label;
    private final String table;
    private final String projectId;
    private final @Nullable String moduleId;

    /**
     * @param id namespaced screen id ({@code boutique:catalog})
     * @param label human label shown in the sidebar
     * @param table project-relative path of the edited Table/Config ({@code data/categories})
     * @param projectId the project whose files the screen edits
     * @param moduleId declaring module, captured at declare time
     */
    public EditorScreenDeclaration(String id, String label, String table, String projectId, @Nullable String moduleId) {
        this.id = Objects.requireNonNull(id, "id");
        this.label = Objects.requireNonNull(label, "label");
        this.table = Objects.requireNonNull(table, "table");
        this.projectId = Objects.requireNonNull(projectId, "projectId");
        this.moduleId = moduleId;
    }

    public String getId() {
        return id;
    }

    public String getLabel() {
        return label;
    }

    public String getTable() {
        return table;
    }

    public String getProjectId() {
        return projectId;
    }

    public @Nullable String getModuleId() {
        return moduleId;
    }

    /** Wire form for Presence payloads ({@code hello.editor_screens}). */
    @Beta
    public Map<String, Object> toWire() {
        Map<String, Object> wire = new LinkedHashMap<>();
        wire.put("id", id);
        wire.put("module_id", moduleId);
        wire.put("label", label);
        wire.put("table", table);
        wire.put("project_id", projectId);
        return wire;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof EditorScreenDeclaration other
            && id.equals(other.id) && label.equals(other.label) && table.equals(other.table)
            && projectId.equals(other.projectId) && Objects.equals(moduleId, other.moduleId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, label, table, projectId, moduleId);
    }

    @Override
    public String toString() {
        return "EditorScreenDeclaration(id=" + id + ", table=" + table + ", projectId=" + projectId + ")";
    }
}
