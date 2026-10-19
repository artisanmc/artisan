package net.artisanmc.modules.api.screen;

import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.datasource.DataSourceRegistry;
import org.jetbrains.annotations.Nullable;

/**
 * Module-declared Config screens ({@code api.screens}), reported at Presence like data sources
 * and declared models. Purely declarative: nothing here is interpreted plugin-side; the editor
 * mounts the entries and the core form generator.
 */
@Beta
public final class EditorScreenRegistry implements OwnedRegistry {
    private static final Pattern COMPONENT = Pattern.compile("^[a-z][a-zA-Z0-9_-]*$");

    private final ConcurrentHashMap<String, EditorScreenDeclaration> screens = new ConcurrentHashMap<>();

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
        screens.values().removeIf(s -> moduleId.equals(s.getModuleId()));
    }

    /**
     * Declares a screen. {@code id} must be namespaced, {@code label} and {@code projectId}
     * non-blank, {@code table} a safe project-relative path ({@link IllegalArgumentException});
     * a duplicate id throws {@link DuplicateEditorScreenException}.
     */
    @Beta
    public void declare(String id, String label, String table, String projectId) {
        declare(id, label, table, projectId, null);
    }

    /**
     * Same as {@link #declare(String, String, String, String)}, rendered by the module's own view:
     * {@code component} is a key of its {@code FrontendModule.screens} ({@code ^[a-z][a-zA-Z0-9_-]*$},
     * {@link IllegalArgumentException} otherwise). The editor falls back to the generated form when
     * the module's bundle has no such view. Since 2.7.0.
     */
    @Beta
    public void declare(String id, String label, String table, String projectId, @Nullable String component) {
        if (!id.contains(":")) {
            throw new IllegalArgumentException("editor screen id must be namespaced (namespace:screen): '" + id + "'");
        }
        if (label.isBlank()) throw new IllegalArgumentException("editor screen '" + id + "' requires a non-blank label");
        if (projectId.isBlank()) throw new IllegalArgumentException("editor screen '" + id + "' requires a projectId");
        if (!isSafeTable(table)) {
            throw new IllegalArgumentException("editor screen '" + id + "' has an unsafe table path: '" + table + "'");
        }
        if (component != null && !COMPONENT.matcher(component).matches()) {
            throw new IllegalArgumentException("editor screen '" + id + "' has an invalid component key: '" + component + "'");
        }
        EditorScreenDeclaration decl = new EditorScreenDeclaration(id, label, table, projectId, currentOwner, component);
        if (screens.putIfAbsent(id, decl) != null) throw new DuplicateEditorScreenException(id);
    }

    /** All declared screens, sorted by id (deterministic presence payload). */
    @Beta
    public List<EditorScreenDeclaration> declared() {
        return screens.values().stream().sorted(Comparator.comparing(EditorScreenDeclaration::getId)).toList();
    }

    private static boolean isSafeTable(String table) {
        if (table.isBlank()) return false;
        if (table.startsWith("/") || table.startsWith("\\") || table.contains("..")) return false;
        if (table.contains(":")) return false;
        String normalized = table.replace('\\', '/');
        int slash = normalized.indexOf('/');
        String first = slash == -1 ? normalized : normalized.substring(0, slash);
        // Same rule as the core's ProjectMetadataPaths.isMeta (this module cannot
        // depend on core): a first segment starting with `.artisan`, any case.
        return !first.regionMatches(true, 0, ".artisan", 0, ".artisan".length());
    }
}
