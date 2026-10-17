package net.artisanmc.modules.api.editor;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * The editor bundles of the modules ({@code api.editorBundles}): at most one per module, keyed by
 * the module that registered it from its {@code onEnable}, and removed with it. Reported at
 * Presence on the module's {@code installed_modules} entry ({@code editor_bundle}); the hub fetches
 * the script on demand ({@code editor_bundle_fetch}).
 *
 * <pre>{@code
 * api.getEditorBundles().register(
 *     EditorBundleDeclaration.fromResource(getClass().getClassLoader(), "artisan-editor/ui.js", "1.0"));
 * }</pre>
 */
@Beta
public final class EditorBundleRegistry implements OwnedRegistry {
    private final Map<String, EditorBundleDeclaration> bundles = new LinkedHashMap<>();

    /** Owner captured for registrations happening right now; see {@link OwnedRegistry#bindOwner}. */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers {@code decl} as the editor view of the module whose {@code onEnable} is running.
     *
     * @throws IllegalStateException outside a module's {@code onEnable}.
     * @throws DuplicateEditorBundleException if that module already registered one.
     */
    @Beta
    public synchronized void register(EditorBundleDeclaration decl) {
        String owner = currentOwner;
        if (owner == null) throw new IllegalStateException("an editor bundle is registered from a module's onEnable");
        if (bundles.containsKey(owner)) throw DuplicateEditorBundleException.of(owner);
        bundles.put(owner, decl);
    }

    /** Removes the bundle of {@code moduleId}; false if it had none. */
    @Beta
    public synchronized boolean unregister(String moduleId) {
        return bundles.remove(moduleId) != null;
    }

    @Internal
    @Override
    public synchronized void unregisterOwnedBy(String moduleId) {
        bundles.remove(moduleId);
    }

    /** The bundle of {@code moduleId}, or null. */
    @Beta
    public synchronized @Nullable EditorBundleDeclaration find(String moduleId) {
        return bundles.get(moduleId);
    }

    /** The bundles by module id, in registration order. */
    @Beta
    public synchronized Map<String, EditorBundleDeclaration> registered() {
        return Collections.unmodifiableMap(new LinkedHashMap<>(bundles));
    }
}
