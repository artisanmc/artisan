package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.MenuYaml
import org.bukkit.Bukkit
import java.util.logging.Logger

/**
 * Auto-binding (§15.4): the caller's args (command, open_menu.context, iteration
 * alias) fill the context_inputs by name; inputs with a `source` (ConnectorBinding)
 * that were not provided are fetched through [fetchSource] (DataSourceRegistry curried
 * on the player, see MenuRenderer); declared defaults fill the rest.
 */
object ContextBinder {
    fun bind(
        menu: MenuYaml,
        callerArgs: Map<String, Any>,
        // Any?: a source returns rows (List<Map>) OR a config object (Map, Project
        // source with shape=config) bound whole, without shaping.
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

    /** filter (string equality) → sort (numeric when possible) → limit. */
    fun shape(
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
     * `toString()`, and a `player`-typed command argument can be forwarded to a data
     * source.
     */
    private fun interpolate(raw: String, args: Map<String, Any>): String =
        net.artisanmc.plugin.expr.renderTemplate(raw, argsScope(args))

    fun interpolateValues(map: Map<String, Any?>, args: Map<String, Any>): Map<String, Any?> =
        map.mapValues { (_, v) -> if (v is String) interpolate(v, args) else v }

    /** Named sub-map of the raw ConnectorBinding ({} if missing or mistyped). */
    private fun mapOf(source: Map<String, Any>, key: String): Map<String, Any?> =
        (source[key] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()

    private fun coerce(raw: String, type: String): Any = when (type) {
        "integer" -> raw.toLongOrNull() ?: raw
        "number"  -> raw.toDoubleOrNull() ?: raw
        "boolean" -> raw.toBooleanStrictOrNull() ?: raw
        // Offline player: keep the raw string ({target} still renders, no crash).
        "player"  -> Bukkit.getPlayerExact(raw) ?: raw
        else      -> raw
    }
}
