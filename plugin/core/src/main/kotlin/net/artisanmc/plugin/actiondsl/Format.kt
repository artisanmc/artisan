package net.artisanmc.plugin.actiondsl

import kotlin.math.abs
import kotlin.math.floor

/**
 * Number + string formatting helpers that mirror JS semantics so the printed DSL
 * is byte-identical across TS and Kotlin (ADR `action-dsl`).
 */

/**
 * Mirror of JS `String(n)` for the numeric domain the DSL uses. JS renders an
 * integral double without a trailing `.0` (`String(100) === "100"`), whereas
 * Kotlin's `Double.toString(100.0)` is `"100.0"`. Integral finite values are
 * therefore emitted as their `Long` form; fractional values fall back to the
 * plain double string (`0.5`, `1.2`), which matches JS for the values in play.
 */
fun jsNum(n: Double): String {
    if (n.isFinite() && n == floor(n) && abs(n) < 1e15) return n.toLong().toString()
    return n.toString()
}

/** Mirror of JS `JSON.stringify(str)` for a plain string value. */
fun jsonStr(s: String): String {
    val out = StringBuilder("\"")
    for (c in s) {
        when (c) {
            '"' -> out.append("\\\"")
            '\\' -> out.append("\\\\")
            '\n' -> out.append("\\n")
            '\r' -> out.append("\\r")
            '\t' -> out.append("\\t")
            '\b' -> out.append("\\b")
            '\u000C' -> out.append("\\f")
            else ->
                if (c < ' ') out.append("\\u%04x".format(c.code))
                else out.append(c)
        }
    }
    out.append("\"")
    return out.toString()
}

/** Canonical reconstruction of an expression token run (single-spaced ops). */
fun exprSource(toks: List<Token>): String {
    val out = StringBuilder()
    toks.forEachIndexed { i, t ->
        val v = if (t.type == TokenType.STRING) jsonStr(t.value) else t.value
        val prev = toks.getOrNull(i - 1)
        val noLeadSpace =
            i == 0 || (t.type == TokenType.OP && (t.value == ")" || t.value == "," || t.value == "("))
        val prevNoTrail = prev == null || (prev.type == TokenType.OP && prev.value == "(")
        out.append(if (noLeadSpace || prevNoTrail) v else " $v")
    }
    return out.toString()
        .replace("( ", "(")
        .replace(" )", ")")
        .replace(" ,", ",")
}
