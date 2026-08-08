package net.artisanmc.modules.api.schemas

import net.artisanmc.modules.api.SchemaVersionReader
import net.artisanmc.modules.api.annotations.Stable
import java.util.concurrent.ConcurrentHashMap

@Stable
class UnsupportedSchemaVersionException(version: String) :
    RuntimeException("No migration registered for schema version '$version'")

@Stable
class CircularMigrationException(version: String) :
    IllegalStateException("Circular migration detected at schema version '$version'")

/**
 * Versioned schema migrator. Modules register migrations from one schema version
 * to the next; [loadToCurrent] chains them automatically to bring legacy data
 * forward.
 *
 * @param T the document type — typically `MutableMap<String, Any?>` for YAML.
 */
@Stable
class SchemaRegistry<T> {
    private val migrations = ConcurrentHashMap<String, SchemaMigration<T>>()

    @Stable
    fun register(migration: SchemaMigration<T>) {
        migrations[migration.from] = migration
    }

    /**
     * Apply migrations until [data] reaches [currentVersion].
     *
     * @param data the input document
     * @param currentVersion the target schema version (e.g. "menu/v2")
     * @param versionOf reads the current schema discriminator from a document
     */
    @Stable
    fun loadToCurrent(data: T, currentVersion: String, versionOf: SchemaVersionReader<T>): T {
        var current = data
        var version = versionOf.versionOf(current)
        val visited = mutableSetOf<String>()

        while (version != currentVersion) {
            if (version in visited) throw CircularMigrationException(version)
            visited.add(version)

            val migration = migrations[version]
                ?: throw UnsupportedSchemaVersionException(version)
            current = migration.migrate(current)
            version = versionOf.versionOf(current)
        }
        return current
    }

    @Stable
    fun has(from: String): Boolean = migrations.containsKey(from)
}
