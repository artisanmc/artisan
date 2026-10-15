package net.artisanmc.modules.api;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/** Data sources registered by modules ({@code api.dataSources}), fetched by ref. */
@Stable
public final class DataSourceRegistry {
    private final ConcurrentHashMap<String, RegisteredDataSource> sources = new ConcurrentHashMap<>();

    /**
     * Owner captured for registrations happening right now. Set by
     * {@link ModuleRegistry#register} around {@code onEnable} (main-thread sequential),
     * null for direct registrations (third-party plugins via ServicesManager).
     */
    volatile @Nullable String currentOwner;

    /** Registers {@code decl}; throws {@link DuplicateDataSourceException} if its ref is taken. */
    @Stable
    public void register(DataSourceDeclaration decl) {
        if (sources.putIfAbsent(decl.getRef(), new RegisteredDataSource(decl, currentOwner)) != null) {
            throw new DuplicateDataSourceException(decl.getRef());
        }
    }

    /** Removes the data source {@code ref}; false if none was registered. */
    @Stable
    public boolean unregister(String ref) {
        return sources.remove(ref) != null;
    }

    void unregisterOwnedBy(String moduleId) {
        sources.values().removeIf(r -> moduleId.equals(r.getModuleId()));
    }

    void unregisterLoadedBy(ClassLoader loader) {
        sources.values().removeIf(r -> r.getDeclaration().getFetcher().getClass().getClassLoader() == loader);
    }

    /** The rows of {@code ref} for {@code player} (null in preview); throws {@link UnknownDataSourceException}. */
    @Stable
    public List<Map<String, Object>> fetch(String ref, @Nullable Player player, Map<String, Object> params) {
        RegisteredDataSource entry = sources.get(ref);
        if (entry == null) throw new UnknownDataSourceException(ref);
        return entry.getDeclaration().getFetcher().fetch(player, params);
    }

    @Stable
    public boolean has(String ref) {
        return sources.containsKey(ref);
    }

    /** A snapshot of the registered refs. */
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
