package gg.interfaze.modules.api

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * @param ref Globally unique reference, format "namespace:id" (e.g. "shop:items").
 * @param fetcher Pure function returning rows for a given player context + params.
 *                Rows are `Map<String, Any?>` — the schema is documented in [schemaHint],
 *                consumers (e.g. menus rendering `data_source.ref`) iterate generically.
 *                Player is typed as `Any` to avoid test dependency on Paper API.
 * @param schemaHint Optional human-readable schema description for tooling (web editor).
 */
data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Any, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schemaHint: String? = null,
)
