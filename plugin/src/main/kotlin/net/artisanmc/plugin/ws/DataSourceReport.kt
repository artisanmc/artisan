package net.artisanmc.plugin.ws

import net.artisanmc.modules.api.DataSourceRegistry

/**
 * Builds the `data_sources` wire payload sent in `hello` / `modules_changed`.
 * One implementation for both call sites (ArtisanPlugin onEnable + reinit).
 * `schema_hint` stays on the wire while `DataSourceDeclaration.schemaHint` is @Sunset.
 */
object DataSourceReport {
    fun build(registry: DataSourceRegistry): List<Map<String, Any?>> =
        registry.registered().map { r ->
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
            )
        }
}
