package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.model.ModelField

/**
 * Typed arguments resolved before the handler (ADR `triggers-and-variables` §6): an argument
 * declared `number`, `integer`, `boolean` or `location` accepts a template (`"{row.price}"`,
 * `"{var.last_death}"`), resolved then converted here, so a handler keeps receiving typed values.
 * A value that does not resolve to its type is a [Failure]: the action is skipped with a warning,
 * never run with a default in its place (a `teleport` to 0,0,0).
 */
object ArgCoercion {
    /** How a template is read: [value] for a lone `{expr}` (typed: a map stays a map), [text] otherwise. */
    interface Resolver {
        /** The value of `expr` (the inside of `{…}`), or null when it does not resolve. */
        fun value(expr: String): Any?

        /** [template] rendered as text (`{…}` and `%papi%`). */
        fun text(template: String): String
    }

    data class Failure(val arg: String, val raw: Any?, val expected: String) {
        fun message(action: String): String = "'$action': argument '$arg' = '$raw' is not a $expected — action skipped"
    }

    /** Kinds this resolves; any other argument is handed to the handler as written. */
    val TYPED = setOf("number", "integer", "boolean", "location")

    /** A template that is one expression and nothing else: `{row.price}`. */
    val LONE_EXPR = Regex("^\\{(?!i18n:)([^{}]+)}$")

    /** [args] with every typed argument of [declared] converted, or the first [Failure]. */
    fun coerce(declared: List<ModelField>, args: Map<String, Any>, resolver: Resolver): Result {
        var out: MutableMap<String, Any>? = null
        for (field in declared) {
            val kind = field.type.kind
            if (kind !in TYPED) continue
            val raw = args[field.name] ?: continue
            val value = convert(kind, raw, resolver) ?: return Result.Failed(Failure(field.name, raw, kind))
            if (value != raw) (out ?: args.toMutableMap().also { out = it })[field.name] = value
        }
        return Result.Ok(out ?: args)
    }

    sealed interface Result {
        data class Ok(val args: Map<String, Any>) : Result
        data class Failed(val failure: Failure) : Result
    }

    /** [raw] as [kind] (`number`, `integer`, `boolean`, `location`), templates resolved; null when it is not one. */
    fun convert(kind: String, raw: Any?, resolver: Resolver): Any? = when (kind) {
        "number" -> when (raw) {
            is Number -> raw
            else -> number(resolve(raw, resolver))
        }
        "integer" -> when (raw) {
            is Int, is Long, is Short, is Byte -> raw
            is Number -> integral(raw.toDouble())
            else -> number(resolve(raw, resolver))?.let { integral(it.toDouble()) }
        }
        "boolean" -> when (raw) {
            is Boolean -> raw
            else -> bool(resolve(raw, resolver))
        }
        "location" -> location(raw, resolver)
        else -> raw
    }

    /** A lone `{expr}` keeps its type; any other text is rendered. */
    private fun resolve(raw: Any?, resolver: Resolver): Any? = when (raw) {
        is String -> {
            val lone = LONE_EXPR.matchEntire(raw.trim())
            if (lone != null) resolver.value(lone.groupValues[1].trim())
            else if ('{' in raw || '%' in raw) resolver.text(raw)
            else raw
        }
        else -> raw
    }

    private fun number(v: Any?): Number? = when (v) {
        is Number -> v.takeIf { it.toDouble().isFinite() }
        is String -> v.trim().toDoubleOrNull()?.takeIf { it.isFinite() }
        else -> null
    }

    private fun integral(d: Double): Long? = if (d == Math.floor(d) && d.isFinite()) d.toLong() else null

    private fun bool(v: Any?): Boolean? = when (v) {
        is Boolean -> v
        is String -> when (v.trim().lowercase()) {
            "true", "yes", "1" -> true
            "false", "no", "0" -> false
            else -> null
        }
        is Number -> when (v.toDouble()) {
            1.0 -> true
            0.0 -> false
            else -> null
        }
        else -> null
    }

    private fun location(raw: Any?, resolver: Resolver): LocationValue? = when (raw) {
        is LocationValue -> raw
        // A map's own entries may be templates: `{world: "{event.location.world}", x: …}`.
        is Map<*, *> -> LocationValue.from(raw.entries.associate { (k, v) -> k.toString() to resolve(v, resolver) })
        else -> LocationValue.from(resolve(raw, resolver))
    }
}
