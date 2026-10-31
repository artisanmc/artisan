package net.artisanmc.modules.api.editor;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * The modules' looks in the editor ({@code api.moduleBrands}): at most one per module, keyed by
 * the module that registered it from its {@code onEnable}, and removed with it. Reported at
 * Presence on the module's {@code installed_modules} entry ({@code brand}); the hub fetches the
 * files on demand ({@code module_brand_fetch}). A module that registers none keeps Artisan's.
 *
 * <pre>{@code
 * if (api.isCompatibleWith("2.23.0")) {
 *     api.getModuleBrands().register(
 *         ModuleBrandDeclaration.fromResources(getClass().getClassLoader(), "artisan-brand"));
 * }
 * }</pre>
 */
@Beta
public final class ModuleBrandRegistry implements OwnedRegistry {
    private final Map<String, ModuleBrandDeclaration> brands = new LinkedHashMap<>();

    /** Owner captured for registrations happening right now; see {@link OwnedRegistry#bindOwner}. */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers {@code decl} as the look of the module whose {@code onEnable} is running; a
     * second call replaces the first.
     *
     * @throws IllegalStateException outside a module's {@code onEnable}.
     */
    public synchronized void register(ModuleBrandDeclaration decl) {
        Objects.requireNonNull(decl, "decl");
        String owner = currentOwner;
        if (owner == null) throw new IllegalStateException("a module brand is registered from a module's onEnable");
        brands.put(owner, decl);
    }

    /** Removes the brand of {@code moduleId}; false if it had none. */
    public synchronized boolean unregister(String moduleId) {
        return brands.remove(moduleId) != null;
    }

    @Internal
    @Override
    public synchronized void unregisterOwnedBy(String moduleId) {
        brands.remove(moduleId);
    }

    /** The brand of {@code moduleId}, or null. */
    public synchronized @Nullable ModuleBrandDeclaration find(String moduleId) {
        return brands.get(moduleId);
    }

    /** The brands by module id, in registration order. */
    public synchronized Map<String, ModuleBrandDeclaration> registered() {
        return Collections.unmodifiableMap(new LinkedHashMap<>(brands));
    }
}
