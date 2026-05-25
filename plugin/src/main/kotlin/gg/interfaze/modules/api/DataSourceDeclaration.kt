package gg.interfaze.modules.api

import org.bukkit.entity.Player

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * @param ref Globally unique reference, format "namespace:id" (e.g. "shop:items").
 * @param fetcher Pure function returning rows for a given player + params.
 *                Rows are `Map<String, Any?>` — the schema is documented in [schemaHint],
 *                consumers (e.g. menus rendering `data_source.ref`) iterate generically.
 * @param schemaHint Optional human-readable schema description for tooling (web editor).
 */
data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Player, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schemaHint: String? = null,
)
