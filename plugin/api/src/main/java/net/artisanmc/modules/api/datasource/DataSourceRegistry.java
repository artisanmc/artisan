package net.artisanmc.modules.api.datasource;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.ModuleRegistry;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/** Data sources registered by modules ({@code api.dataSources}), fetched by ref. */
@Stable
public final class DataSourceRegistry implements OwnedRegistry {
    private final ConcurrentHashMap<String, RegisteredDataSource> sources = new ConcurrentHashMap<>();
    /** Alias to the ref of the source that declared it ({@link DataSourceDeclaration#withAliases}). */
    private final ConcurrentHashMap<String, String> aliases = new ConcurrentHashMap<>();

    /**
     * Owner captured for registrations happening right now. Set by
     * {@link ModuleRegistry#register} around {@code onEnable} (main-thread sequential),
     * null for direct registrations (third-party plugins via ServicesManager).
     */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers {@code decl}; throws {@link DuplicateDataSourceException} if its ref or one of its
     * aliases is taken, by a source or by another source's alias. Nothing is registered then.
     */
    @Stable
    public synchronized void register(DataSourceDeclaration decl) {
        if (sources.containsKey(decl.getRef()) || aliases.containsKey(decl.getRef())) {
            throw new DuplicateDataSourceException(decl.getRef());
        }
        for (String alias : decl.getAliases()) {
            if (sources.containsKey(alias) || aliases.containsKey(alias)) throw new DuplicateDataSourceException(alias);
        }
        sources.put(decl.getRef(), new RegisteredDataSource(decl, currentOwner));
        for (String alias : decl.getAliases()) aliases.put(alias, decl.getRef());
    }

    /** Removes the data source {@code ref} and its aliases; false if none was registered (an alias is not a source). */
    @Stable
    public synchronized boolean unregister(String ref) {
        if (sources.remove(ref) == null) return false;
        aliases.values().removeIf(ref::equals);
        return true;
    }

    @Internal
    @Override
    public synchronized void unregisterOwnedBy(String moduleId) {
        sources.values().removeIf(r -> moduleId.equals(r.getModuleId()));
        aliases.values().removeIf(ref -> !sources.containsKey(ref));
    }

    @Internal
    @Override
    public synchronized void unregisterLoadedBy(ClassLoader loader) {
        sources.values().removeIf(r -> r.getDeclaration().getFetcher().getClass().getClassLoader() == loader);
        aliases.values().removeIf(ref -> !sources.containsKey(ref));
    }

    /**
     * The rows of {@code ref}, or of the source {@code ref} is an alias of, for {@code player}
     * (null in preview); throws {@link UnknownDataSourceException}.
     */
    @Stable
    public List<Map<String, Object>> fetch(String ref, @Nullable Player player, Map<String, Object> params) {
        String canonical = resolve(ref);
        RegisteredDataSource entry = canonical == null ? null : sources.get(canonical);
        if (entry == null) throw new UnknownDataSourceException(ref);
        return entry.getDeclaration().getFetcher().fetch(player, params);
    }

    /** True for a registered ref and for an alias of one. */
    @Stable
    public boolean has(String ref) {
        return resolve(ref) != null;
    }

    /**
     * The ref of the source {@code ref} names: itself when registered, the source's when it is an
     * alias, null when unknown.
     *
     * @since 1.2.0
     */
    @Beta
    public @Nullable String resolve(String ref) {
        if (sources.containsKey(ref)) return ref;
        String canonical = aliases.get(ref);
        return canonical != null && sources.containsKey(canonical) ? canonical : null;
    }

    /** A snapshot of the registered refs, aliases left out. */
    @Stable
    public Set<String> refs() {
        return Set.copyOf(sources.keySet());
    }

    /** The declarations, sorted by ref. */
    @Stable
    public List<DataSourceDeclaration> declarations() {
        return sources.values().stream()
            .map(RegisteredDataSource::getDeclaration)
            .sorted(Comparator.comparing(DataSourceDeclaration::getRef))
            .toList();
    }

    /** Declarations with their owning module id, sorted by ref. */
    @Stable
    public List<RegisteredDataSource> registered() {
        return sources.values().stream()
            .sorted(Comparator.comparing(r -> r.getDeclaration().getRef()))
            .toList();
    }
}
