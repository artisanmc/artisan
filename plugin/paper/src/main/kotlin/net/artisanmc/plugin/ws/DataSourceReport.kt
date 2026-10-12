package net.artisanmc.plugin.ws

import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.RegisteredDataSource

/**
 * Builds the `data_sources` wire payload sent in `hello` / `modules_changed`.
 * One implementation for both call sites (ArtisanPlugin onEnable + reinit).
 * `schema_hint` stays on the wire while `DataSourceDeclaration.schemaHint` is @Sunset.
 */
object DataSourceReport {
    fun build(registry: DataSourceRegistry): List<Map<String, Any?>> = build(registry.registered())

    fun build(sources: List<RegisteredDataSource>): List<Map<String, Any?>> =
        sources.map { r ->
            mapOf(
                "ref" to r.declaration.ref,
                "module_id" to r.moduleId,
                "schema" to r.declaration.schema.map { f ->
                    mapOf(
                        "name" to f.name,
                        "type" to f.type.name.lowercase(),
                        "description" to f.description,
                    )
                },
                "schema_hint" to r.declaration.schemaHint,
                "stability" to r.declaration.stability.name.lowercase(),
                "key_field" to r.declaration.keyField,
            )
        }
}
