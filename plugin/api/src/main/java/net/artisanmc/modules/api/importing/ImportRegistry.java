package net.artisanmc.modules.api.importing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * The sources the modules import from ({@code api.getImports()}, ADR {@code data-imports}).
 * Artisan runs them through {@code /artisan import}: a dry run first, the write on
 * {@code confirm}, one run at a time per module, each logged with its report. A module's own
 * command may call its importer too.
 *
 * <pre>{@code
 * api.getImports().register(new ImporterDeclaration(
 *     "auctions:zauctionhouse", "zAuctionHouse v4", List.of("zAuctionHouse"), false, importer));
 * }</pre>
 */
@Beta
public final class ImportRegistry implements OwnedRegistry {
    private final Map<String, ImporterDeclaration> sources = new LinkedHashMap<>();
    private final Map<String, String> owners = new LinkedHashMap<>();
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers a source. From a module's {@code onEnable}, the id's namespace must be that module.
     *
     * @throws IllegalStateException when the id is taken, or its namespace is another module's
     */
    public synchronized void register(ImporterDeclaration declaration) {
        String owner = currentOwner;
        if (owner != null && !owner.equals(declaration.module())) {
            throw new IllegalStateException("module '" + owner + "' cannot register the import source '" + declaration.id() + "'");
        }
        if (sources.containsKey(declaration.id())) {
            throw new IllegalStateException("import source '" + declaration.id() + "' is already registered");
        }
        sources.put(declaration.id(), declaration);
        owners.put(declaration.id(), owner != null ? owner : declaration.module());
    }

    /** Removes a source registered outside a module's {@code onEnable}. */
    public synchronized void unregister(String id) {
        sources.remove(id);
        owners.remove(id);
    }

    @Internal
    @Override
    public synchronized void unregisterOwnedBy(String moduleId) {
        owners.entrySet().removeIf(e -> {
            if (!e.getValue().equals(moduleId)) return false;
            sources.remove(e.getKey());
            return true;
        });
    }

    @Internal
    @Override
    public synchronized void unregisterLoadedBy(ClassLoader loader) {
        sources.values().removeIf(d -> d.importer().getClass().getClassLoader() == loader);
        owners.keySet().retainAll(sources.keySet());
    }

    public synchronized @Nullable ImporterDeclaration find(String id) {
        return sources.get(id);
    }

    /** Every source, in registration order. */
    public synchronized List<ImporterDeclaration> registered() {
        return new ArrayList<>(sources.values());
    }
}
