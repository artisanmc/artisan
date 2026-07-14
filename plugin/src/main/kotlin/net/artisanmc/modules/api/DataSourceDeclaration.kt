package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.annotations.Sunset
import org.bukkit.entity.Player

/** Row-field kinds a data source can declare in its [DataSourceDeclaration.schema]. */
@Stable
enum class FieldKind { STRING, NUMBER, INTEGER, BOOLEAN, LIST, OBJECT }

/** One declared row field — drives editor tooling (schema table, filter autocomplete). */
@Stable
data class DataSourceField(
    val name: String,
    val type: FieldKind,
    val description: String? = null,
)

/**
 * Thrown by a fetcher that cannot produce meaningful rows without a real player
 * (preview mode calls it with `player = null`). Surfaced to the editor as the
 * typed `player_required` preview error.
 */
@Stable
class PlayerRequiredException(message: String? = null) : RuntimeException(message)

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * @param ref Globally unique reference, format "namespace:id" (e.g. "shop:items").
 * @param fetcher Pure function returning rows for a given player + params.
 *                `player` is null in preview mode (editor "Prévisualiser") — return
 *                generic data or throw [PlayerRequiredException].
 *                Called on the server main thread at menu render time: MUST
 *                return fast (serve from an in-memory cache, no blocking I/O).
 * @param schema Declared row fields — powers the editor's schema table and
 *               filter autocomplete. Empty = undeclared (editor falls back to free input).
 * @param schemaHint Legacy human-readable schema description. Superseded by [schema].
 */
@Stable
data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schema: List<DataSourceField> = emptyList(),
    @property:Sunset(
        reason = "Superseded by typed schema field declarations",
        removeInVersion = "2.0.0",
        replacement = "schema"
    )
    val schemaHint: String? = null,
)
