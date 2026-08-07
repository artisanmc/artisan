package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.MenuYaml
import org.bukkit.Bukkit
import java.util.logging.Logger

/**
 * Auto-binding §15.4 : les args de l'appelant (commande, open_menu.context,
 * alias d'itération) peuplent les context_inputs par nom ; les inputs à
 * `source` (ConnectorBinding) non fournis sont fetchés via [fetchSource]
 * (DataSourceRegistry curryfié sur le player, cf. MenuRenderer) ; les
 * defaults déclarés comblent le reste.
 */
object ContextBinder {
    fun bind(
        menu: MenuYaml,
        callerArgs: Map<String, Any>,
        // Any? : une source renvoie des rows (List<Map>) OU un objet de config
        // (Map, Project source shape=config) bindé entier sans shaping.
        fetchSource: ((ref: String, params: Map<String, Any?>) -> Any?)? = null,
        logger: Logger? = null,
    ): Map<String, Any> {
        val out = callerArgs.toMutableMap()
        for (input in menu.contextInputs) {
            if (input.name.isEmpty() || out.containsKey(input.name)) continue
            val ref = (input.source["ref"] as? String)?.takeIf { it.isNotEmpty() }
            if (ref != null && fetchSource != null) {
                val fetched = runCatching {
                    fetchSource(ref, interpolateValues(mapOf(input.source, "params"), out))
                }.getOrElse { e ->
                    logger?.warning("[Artisan] data source '$ref' failed for input '${input.name}': ${e.message}")
                    null
                }
                when (fetched) {
                    is List<*> -> {
                        @Suppress("UNCHECKED_CAST")
                        out[input.name] = shape(fetched as List<Map<String, Any?>>, input.source, out)
                        continue
                    }
                    is Map<*, *> -> {
                        out[input.name] = fetched
                        continue
                    }
                    else -> { /* null/unusable → defaults below */ }
                }
            }
            val d = input.default ?: continue
            out[input.name] = coerce(d, input.type)
        }
        return out
    }

    /** filter (égalité string) → sort (numérique si possible) → limit. */
    internal fun shape(
        rows: List<Map<String, Any?>>,
        source: Map<String, Any>,
        args: Map<String, Any>,
    ): List<Map<String, Any?>> {
        var result = rows
        val filter = mapOf(source, "filter")
        if (filter.isNotEmpty()) {
            result = result.filter { row ->
                filter.all { (field, expected) ->
                    row[field]?.toString() == interpolate(expected?.toString() ?: "", args)
                }
            }
        }
        val sort = source["sort"] as? Map<*, *>
        val by = sort?.get("by")?.toString()
        if (by != null) {
            val allNumeric = result.all { it[by]?.toString()?.toDoubleOrNull() != null }
            result = if (allNumeric) result.sortedBy { it[by].toString().toDouble() }
                     else result.sortedBy { it[by]?.toString() ?: "" }
            if (sort["direction"]?.toString() == "desc") result = result.reversed()
        }
        val limit = (source["limit"] as? Number)?.toInt()
        if (limit != null && limit > 0) result = result.take(limit)
        return result
    }

    /**
     * A params or filter value is a **Template** like any other authored string, so
     * `{target.name}` resolves and a Bukkit `Player` renders its name instead of its
     * `toString()`. This was a private regex — the last surviving copy of the deleted
     * `ArgResolver` (ADR `expression-parity` §5), and the reason a `player`-typed
     * command argument could not be forwarded to a data source.
     */
    private fun interpolate(raw: String, args: Map<String, Any>): String =
        net.artisanmc.plugin.expr.renderTemplate(raw, argsScope(args))

    internal fun interpolateValues(map: Map<String, Any?>, args: Map<String, Any>): Map<String, Any?> =
        map.mapValues { (_, v) -> if (v is String) interpolate(v, args) else v }

    /** Sous-map nommée du ConnectorBinding brut ({} si absente/mal typée). */
    private fun mapOf(source: Map<String, Any>, key: String): Map<String, Any?> =
        (source[key] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()

    private fun coerce(raw: String, type: String): Any = when (type) {
        "integer" -> raw.toLongOrNull() ?: raw
        "number"  -> raw.toDoubleOrNull() ?: raw
        "boolean" -> raw.toBooleanStrictOrNull() ?: raw
        // Joueur hors-ligne → on garde la string brute ({target} reste rendable, pas de crash).
        "player"  -> Bukkit.getPlayerExact(raw) ?: raw
        else      -> raw
    }
}
