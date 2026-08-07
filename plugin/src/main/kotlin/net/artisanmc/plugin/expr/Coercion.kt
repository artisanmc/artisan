package net.artisanmc.plugin.expr

/**
 * Coercion rules — mirror of `editor/src/lib/expr/coercion.ts`, which is
 * authoritative. Kotlin has no `undefined`, so both JS `null` and `undefined`
 * map to Kotlin `null`.
 */

fun toBooleanValue(v: Any?): Boolean = when (v) {
    null -> false
    is Boolean -> v
    is Number -> v.toDouble() != 0.0
    is String -> v.isNotEmpty()
    else -> true
}

fun toNumberOrNull(v: Any?): Double? = when (v) {
    is Boolean -> null
    is Number -> v.toDouble().let { if (it.isNaN()) null else it }
    is String -> {
        val t = v.trim()
        if (t.isEmpty()) null else t.toDoubleOrNull()
    }
    else -> null
}

/**
 * String rendering of a value. Numbers drop a trailing `.0` so `250.0` reads
 * `250` — JS has one numeric type and prints integers without decimals, and the
 * conformance vector pins that.
 */
fun toStringValue(v: Any?): String = when (v) {
    null -> ""
    is String -> v
    is Boolean -> if (v) "true" else "false"
    is Number -> {
        val d = v.toDouble()
        if (d == Math.floor(d) && !d.isInfinite() && Math.abs(d) < 1e21) d.toLong().toString()
        else d.toString()
    }
    is List<*> -> v.joinToString(",") { toStringValue(it) }
    is Map<*, *> -> v.toString()
    else -> v.toString()
}

fun looseEq(a: Any?, b: Any?): Boolean {
    val aEmpty = a == null || a == ""
    val bEmpty = b == null || b == ""
    if (aEmpty && bEmpty) return true
    if (aEmpty || bEmpty) return false
    val an = toNumberOrNull(a)
    val bn = toNumberOrNull(b)
    if (an != null && bn != null) return an == bn
    return toStringValue(a) == toStringValue(b)
}

fun compareValues(a: Any?, b: Any?, op: String): Boolean {
    val an = toNumberOrNull(a)
    val bn = toNumberOrNull(b)
    if (an != null && bn != null) {
        return when (op) {
            "<" -> an < bn
            "<=" -> an <= bn
            ">" -> an > bn
            else -> an >= bn
        }
    }
    val cmp = toStringValue(a).compareTo(toStringValue(b))
    return when (op) {
        "<" -> cmp < 0
        "<=" -> cmp <= 0
        ">" -> cmp > 0
        else -> cmp >= 0
    }
}
