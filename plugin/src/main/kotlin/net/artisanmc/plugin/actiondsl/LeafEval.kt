package net.artisanmc.plugin.actiondsl

/**
 * Leaf expression evaluator for the Action DSL (ADR `action-dsl` §6).
 *
 * Evaluates a SINGLE boolean-ish expression — NO `and`/`or`/`not` (those are
 * handled structurally by the condition tree). Supported subset:
 *   - operands: number / string / `true` / `false` / `null` literals, dotted
 *     path identifiers (`balance`, `item.price`) resolved against a scope, and
 *     `%papi%` placeholders.
 *   - arithmetic: `+` and `-` only, left-to-right.
 *   - comparison: `== != < <= > >=` → Boolean. A bare operand is returned as-is
 *     (the caller coerces to Boolean via [toLeafBoolean]).
 *
 * Coercion rules mirror the TS reference `editor/src/lib/expr/coercion.ts`
 * EXACTLY (that stack wins on any edge). Tolerant: any lex/parse/eval error →
 * `null`, never throws. A missing path resolves to `null`.
 *
 * OUT of scope (deferred advanced tail): `* / %`, list methods, ternary `?:`,
 * index `[]`, nested `{i18n:}`.
 */

/** Evaluate [expr] against [scope]; `null` on any error. [papi] resolves `%name%` (without %). */
fun evalLeaf(
    expr: String,
    scope: Map<String, Any?>,
    papi: ((String) -> String?)? = null,
): Any? = runCatching { evalLeafOrThrow(expr, scope, papi) }.getOrNull()

/**
 * Same as [evalLeaf] but propagates lex/parse errors so a caller can distinguish
 * a genuine parse failure from a legitimate `null` result (missing path, `null`
 * literal, unresolved `%papi%`). A missing path still resolves to `null`.
 */
fun evalLeafOrThrow(
    expr: String,
    scope: Map<String, Any?>,
    papi: ((String) -> String?)? = null,
): Any? {
    val tokens = lexLeaf(expr)
    return LeafParser(tokens, scope, papi).parse()
}

/** Coerce a leaf value to Boolean using the DSL truthiness rules. */
fun toLeafBoolean(v: Any?): Boolean = when (v) {
    null -> false
    is Boolean -> v
    is Number -> v.toDouble() != 0.0 && !v.toDouble().isNaN()
    is String -> v.isNotEmpty()
    else -> true
}

// ─── Coercion (mirror of coercion.ts) ───────────────────────────────────────

private fun toNumberOrNull(v: Any?): Double? = when (v) {
    is Number -> v.toDouble().let { if (it.isNaN()) null else it }
    is String -> {
        val t = v.trim()
        if (t.isEmpty()) null else t.toDoubleOrNull()
    }
    else -> null
}

private fun toStringValue(v: Any?): String = when (v) {
    null -> ""
    is String -> v
    is Number -> jsNum(v.toDouble())
    is Boolean -> if (v) "true" else "false"
    is List<*> -> v.joinToString(",") { toStringValue(it) }
    else -> v.toString()
}

private fun isEmptyValue(v: Any?): Boolean = v == null || v == ""

private fun looseEq(a: Any?, b: Any?): Boolean {
    val aEmpty = isEmptyValue(a)
    val bEmpty = isEmptyValue(b)
    if (aEmpty && bEmpty) return true
    if (aEmpty || bEmpty) return false
    val an = toNumberOrNull(a)
    val bn = toNumberOrNull(b)
    if (an != null && bn != null) return an == bn
    return toStringValue(a) == toStringValue(b)
}

private fun compareValues(a: Any?, b: Any?, op: String): Boolean {
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
    val asv = toStringValue(a)
    val bsv = toStringValue(b)
    return when (op) {
        "<" -> asv < bsv
        "<=" -> asv <= bsv
        ">" -> asv > bsv
        else -> asv >= bsv
    }
}

private fun arithPlus(left: Any?, right: Any?): Any? {
    if (left is String || right is String) return toStringValue(left) + toStringValue(right)
    val ln = toNumberOrNull(left)
    val rn = toNumberOrNull(right)
    return if (ln != null && rn != null) ln + rn else null
}

private fun arithMinus(left: Any?, right: Any?): Any? {
    if (left is String) return null
    val ln = toNumberOrNull(left)
    val rn = toNumberOrNull(right)
    return if (ln != null && rn != null) ln - rn else null
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

private enum class LeafTok { NUMBER, STRING, WORD, PAPI, OP }

private data class LeafToken(val type: LeafTok, val text: String)

private val LEAF_WORD_RE = Regex("[A-Za-z_][A-Za-z0-9_.]*")
private val LEAF_PAPI_RE = Regex("%[A-Za-z_][A-Za-z0-9_]*%")
private val LEAF_NUMBER_RE = Regex("[0-9]+(?:\\.[0-9]+)?")
private val LEAF_TWO_OPS = setOf("==", "!=", "<=", ">=")
private val LEAF_ONE_OPS = setOf("<", ">", "+", "-", "(", ")")

private fun lexLeaf(src: String): List<LeafToken> {
    val out = mutableListOf<LeafToken>()
    var i = 0
    val n = src.length
    while (i < n) {
        val c = src[i]
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            i++
            continue
        }
        if (c == '"') {
            val sb = StringBuilder()
            var j = i + 1
            while (j < n) {
                val d = src[j]
                if (d == '\\') {
                    val nxt = if (j + 1 < n) src[j + 1] else null
                    sb.append(
                        when (nxt) {
                            'n' -> "\n"
                            't' -> "\t"
                            null -> ""
                            else -> nxt.toString()
                        },
                    )
                    j += 2
                    continue
                }
                if (d == '"') break
                sb.append(d)
                j++
            }
            if (j >= n) throw IllegalArgumentException("Unterminated string")
            out.add(LeafToken(LeafTok.STRING, sb.toString()))
            i = j + 1
            continue
        }
        if (c == '%') {
            val m = LEAF_PAPI_RE.matchAt(src, i) ?: throw IllegalArgumentException("Malformed placeholder")
            out.add(LeafToken(LeafTok.PAPI, m.value.substring(1, m.value.length - 1)))
            i = m.range.last + 1
            continue
        }
        if (c in '0'..'9') {
            val m = LEAF_NUMBER_RE.matchAt(src, i)!!
            out.add(LeafToken(LeafTok.NUMBER, m.value))
            i = m.range.last + 1
            continue
        }
        val two = if (i + 2 <= n) src.substring(i, i + 2) else ""
        if (two in LEAF_TWO_OPS) {
            out.add(LeafToken(LeafTok.OP, two))
            i += 2
            continue
        }
        if (c.toString() in LEAF_ONE_OPS) {
            out.add(LeafToken(LeafTok.OP, c.toString()))
            i++
            continue
        }
        if (c in 'A'..'Z' || c in 'a'..'z' || c == '_') {
            val m = LEAF_WORD_RE.matchAt(src, i)!!
            out.add(LeafToken(LeafTok.WORD, m.value))
            i = m.range.last + 1
            continue
        }
        throw IllegalArgumentException("Unexpected character '$c'")
    }
    return out
}

// ─── Recursive-descent parser + evaluator (eval-while-parse) ────────────────

private class LeafParser(
    private val tokens: List<LeafToken>,
    private val scope: Map<String, Any?>,
    private val papi: ((String) -> String?)?,
) {
    private var i = 0

    private fun peek(): LeafToken? = tokens.getOrNull(i)

    fun parse(): Any? {
        val v = comparison()
        if (i != tokens.size) throw IllegalArgumentException("Trailing tokens")
        return v
    }

    private fun comparison(): Any? {
        val left = additive()
        val t = peek()
        if (t != null && t.type == LeafTok.OP && t.text in COMPARE_OPS) {
            i++
            val right = additive()
            return when (t.text) {
                "==" -> looseEq(left, right)
                "!=" -> !looseEq(left, right)
                else -> compareValues(left, right, t.text)
            }
        }
        return left
    }

    private fun additive(): Any? {
        var v = primary()
        while (true) {
            val t = peek()
            if (t != null && t.type == LeafTok.OP && (t.text == "+" || t.text == "-")) {
                i++
                val r = primary()
                v = if (t.text == "+") arithPlus(v, r) else arithMinus(v, r)
            } else {
                return v
            }
        }
    }

    private fun primary(): Any? {
        val t = peek() ?: throw IllegalArgumentException("Unexpected end of expression")
        when (t.type) {
            LeafTok.NUMBER -> {
                i++
                return t.text.toDouble()
            }
            LeafTok.STRING -> {
                i++
                return t.text
            }
            LeafTok.PAPI -> {
                i++
                return papi?.invoke(t.text)
            }
            LeafTok.WORD -> {
                i++
                return when (t.text) {
                    "true" -> true
                    "false" -> false
                    "null" -> null
                    else -> resolvePath(t.text)
                }
            }
            LeafTok.OP -> {
                if (t.text == "(") {
                    i++
                    val inner = comparison()
                    val close = peek()
                    if (close == null || close.type != LeafTok.OP || close.text != ")") {
                        throw IllegalArgumentException("Expected ')'")
                    }
                    i++
                    return inner
                }
                throw IllegalArgumentException("Unexpected operator '${t.text}'")
            }
        }
    }

    /** Walk a dotted path against the scope; missing → null (safe access). */
    private fun resolvePath(name: String): Any? {
        val parts = name.split('.')
        var cur: Any? = scope[parts[0]]
        for (k in 1 until parts.size) {
            cur = when (cur) {
                is Map<*, *> -> cur[parts[k]]
                else -> return null
            }
        }
        return cur
    }

    companion object {
        private val COMPARE_OPS = setOf("==", "!=", "<", "<=", ">", ">=")
    }
}
