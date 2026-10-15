package net.artisanmc.modules.api.schemas;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.SchemaVersionReader;
import net.artisanmc.modules.api.annotations.Stable;

/**
 * Versioned schema migrator ({@code api.schemas}). Modules register migrations from one schema
 * version to the next; {@link #loadToCurrent} chains them to bring legacy data forward.
 *
 * @param <T> the document type, {@code Map<String, Object>} for YAML
 */
@Stable
public final class SchemaRegistry<T> {
    private final ConcurrentHashMap<String, SchemaMigration<T>> migrations = new ConcurrentHashMap<>();

    @Stable
    public void register(SchemaMigration<T> migration) {
        migrations.put(migration.getFrom(), migration);
    }

    /**
     * Applies migrations until {@code data} reaches {@code currentVersion}.
     *
     * @param data the input document
     * @param currentVersion the target schema version (e.g. {@code "shop/v2"})
     * @param versionOf reads the current schema discriminator from a document
     * @throws UnsupportedSchemaVersionException when no migration starts at the document's version
     * @throws CircularMigrationException when the migrations loop
     */
    @Stable
    public T loadToCurrent(T data, String currentVersion, SchemaVersionReader<T> versionOf) {
        T current = data;
        String version = versionOf.versionOf(current);
        Set<String> visited = new HashSet<>();
        while (!version.equals(currentVersion)) {
            if (!visited.add(version)) throw new CircularMigrationException(version);
            SchemaMigration<T> migration = migrations.get(version);
            if (migration == null) throw new UnsupportedSchemaVersionException(version);
            current = migration.migrate(current);
            version = versionOf.versionOf(current);
        }
        return current;
    }

    @Stable
    public boolean has(String from) {
        return migrations.containsKey(from);
    }
}
