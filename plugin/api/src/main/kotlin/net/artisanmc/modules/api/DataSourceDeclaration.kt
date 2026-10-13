package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.annotations.Sunset
import org.bukkit.entity.Player

/** One declared row field — drives editor tooling (schema table, filter autocomplete). */
@Stable
data class DataSourceField @JvmOverloads constructor(
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
class PlayerRequiredException @JvmOverloads constructor(message: String? = null) : RuntimeException(message)

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * @param ref Globally unique reference, format "namespace:id" (e.g. "shop:items").
 * @param fetcher Pure function returning rows for a given player + params.
 *                `player` is null in preview mode (the editor's preview) — return
 *                generic data or throw [PlayerRequiredException].
 *                Called on the server main thread at menu render time: MUST
 *                return fast (serve from an in-memory cache, no blocking I/O).
 * @param schema Declared row fields — powers the editor's schema table and
 *               filter autocomplete. Empty = undeclared (editor falls back to free input).
 * @param schemaHint Legacy human-readable schema description. Superseded by [schema].
 * @param stability Whether the row key-set is authorable at design time ([Stability]).
 *                  Defaults to [Stability.DYNAMIC] — a source is only placeable if it
 *                  opts into [Stability.STATIC] and declares a [keyField].
 * @param keyField Name of the schema field identifying each row (the Row key). Required
 *                 when [stability] is [Stability.STATIC]; ignored (typically null) otherwise.
 */
@Stable
data class DataSourceDeclaration @JvmOverloads constructor(
    val ref: String,
    val fetcher: DataFetcher,
    val schema: List<DataSourceField> = emptyList(),
    @property:Sunset(
        reason = "Superseded by typed schema field declarations",
        removeInVersion = "2.0.0",
        replacement = "schema"
    )
    val schemaHint: String? = null,
    val stability: Stability = Stability.DYNAMIC,
    val keyField: String? = null,
) {
    init {
        require(stability != Stability.STATIC || !keyField.isNullOrBlank()) {
            "Static data source '$ref' must declare a keyField (the Row key identifying each row)"
        }
    }
}
