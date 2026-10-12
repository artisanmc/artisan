package net.artisanmc.plugin.expr

/**
 * Template layer — mirror of `editor/src/lib/expr/template/`
 * (tokenizer + i18n + renderer), locked by `testdata/template-conformance.json`.
 *
 * A Template is every player-facing string authored in the editor: item name,
 * lore line, menu title, material. It renders in one pass:
 *   1. recursive `{i18n:key}` resolution (cycle-detected, depth-limited)
 *   2. tokenize into literal / expression segments
 *   3. evaluate each expression segment
 *   4. resolve the `%papi%` tokens that survived in literals
 */

sealed class Segment {
    data class Literal(val text: String) : Segment()
    data class Expression(val text: String) : Segment()
    data class I18n(val key: String) : Segment()
}

private const val I18N_PREFIX = "i18n:"
private const val MAX_I18N_DEPTH = 5

/**
 * Split a template into segments. Brace matching respects quoted strings and
 * nesting, so `{xs.join(", ")}` and `{a == "}" ? 1 : 2}` tokenize correctly.
 * Tolerant: an unmatched brace leaves the rest of the string literal.
 */
fun tokenizeTemplate(src: String): List<Segment> {
    val out = mutableListOf<Segment>()
    var i = 0
    var literalStart = 0

    fun flushLiteral(end: Int) {
        if (end > literalStart) out += Segment.Literal(src.substring(literalStart, end))
    }

    while (i < src.length) {
        if (src[i] != '{') {
            i++
            continue
        }

        var depth = 1
        var j = i + 1
        var inString: Char? = null
        while (j < src.length && depth > 0) {
            val ch = src[j]
            if (inString != null) {
                if (ch == '\\' && j + 1 < src.length) { j += 2; continue }
                if (ch == inString) inString = null
                j++
                continue
            }
            if (ch == '"' || ch == '\'') { inString = ch; j++; continue }
            if (ch == '{') depth++ else if (ch == '}') depth--
            if (depth == 0) break
            j++
        }

        if (depth != 0) {
            // Unmatched brace — the rest of the string stays literal.
            i = src.length
            break
        }

        val content = src.substring(i + 1, j)
        if (content.isEmpty()) {
            // `{}` is literal, not an empty expression.
            i = j + 1
            continue
        }

        flushLiteral(i)
        out += if (content.startsWith(I18N_PREFIX)) Segment.I18n(content.removePrefix(I18N_PREFIX))
        else Segment.Expression(content)

        i = j + 1
        literalStart = i
    }

    flushLiteral(src.length)
    if (out.isEmpty()) out += Segment.Literal(src)
    return out
}

private val I18N_RE = Regex("""\{i18n:([a-zA-Z0-9_.-]+)}""")

/**
 * Recursively replace `{i18n:key}` with its translation. A missing key keeps its
 * source visible (ADR `expression-parity` §4); cycles and excess depth insert a
 * ⚠️ marker.
 */
fun resolveI18n(template: String, lookup: (String) -> String?): String =
    resolveI18n(template, lookup, LinkedHashSet(), 0)

private fun resolveI18n(
    template: String,
    lookup: (String) -> String?,
    visiting: MutableSet<String>,
    depth: Int,
): String {
    if (depth > MAX_I18N_DEPTH) return "⚠️ i18n depth exceeded"
    return I18N_RE.replace(template) { m ->
        val key = m.groupValues[1]
        if (key in visiting) {
            "⚠️ i18n cycle: " + (visiting + key).joinToString("→")
        } else {
            val raw = lookup(key)
            if (raw == null) m.value else {
                visiting += key
                val resolved = resolveI18n(raw, lookup, visiting, depth + 1)
                visiting -= key
                resolved
            }
        }
    }
}

private val PAPI_RE = Regex("""%([a-z_][a-z0-9_]*)%""")

/**
 * Parsed-expression cache. Parsing is a pure function of the expression text, so
 * it is shared across rows, players and menus; evaluation is not and runs every
 * time. Expression texts come from Project files, so the set is finite — the
 * Bundle pre-warms this at load, which is also when a malformed expression is
 * reported (ADR `expression-parity` §2).
 *
 * Note the *segments* of a template cannot be cached the same way: `{i18n:…}`
 * resolves before tokenizing and depends on the viewer's language.
 */
object ExprCache {
    private val asts = java.util.concurrent.ConcurrentHashMap<String, Any>()

    /** Parsed AST, or the [ParseError] it failed with — both are worth caching. */
    fun get(expr: String): Any = asts.getOrPut(expr) {
        try {
            parseExpr(expr)
        } catch (e: ParseError) {
            e
        }
    }

    fun clear() = asts.clear()
}

/** Render [template] to its final string. */
fun renderTemplate(
    template: String,
    scope: ExprScope,
    i18nLookup: (String) -> String? = { null },
): String {
    val sb = StringBuilder()
    for (seg in tokenizeTemplate(resolveI18n(template, i18nLookup))) {
        when (seg) {
            is Segment.Literal -> sb.append(seg.text)
            // A key that survived tokenizing was not resolvable — keep it visible.
            is Segment.I18n -> sb.append("{i18n:${seg.key}}")
            is Segment.Expression -> sb.append(evalSegment(seg.text, scope))
        }
    }

    return PAPI_RE.replace(sb.toString()) { m ->
        val v = scope.papi(m.groupValues[1])
        if (v.isEmpty()) m.value else v
    }
}

private fun evalSegment(expr: String, scope: ExprScope): String {
    val cached = ExprCache.get(expr)
    if (cached is ParseError) return "⚠️ ${cached.message}"
    val ast = cached as Node
    // An unbound root identifier means the author named something that does not
    // exist — render the source so the mistake is visible in game rather than
    // silently erasing the text. A *bound* root with a missing field is normal.
    for (name in rootIdentifiers(ast)) {
        if (!scope.has(name)) return "{$expr}"
    }
    return try {
        toStringValue(evaluateExpr(ast, scope))
    } catch (e: Exception) {
        "⚠️ ${e.message}"
    }
}

/**
 * Parse every expression of [source] up front, returning one message per
 * malformed segment (empty when the template is sound).
 *
 * Called at bundle load so a broken expression is reported **once, with its
 * file**, instead of surfacing as a ⚠️ to the first player who opens the menu
 * (ADR `expression-parity` §2). It also warms [ExprCache], so rendering a row
 * never parses.
 *
 * Only the raw source is walked: expressions living inside a *translation* are
 * unknown until a viewer's language is picked, and stay lazily cached.
 */
fun warmTemplate(source: String): List<String> =
    tokenizeTemplate(source)
        .filterIsInstance<Segment.Expression>()
        .mapNotNull { seg ->
            val parsed = ExprCache.get(seg.text)
            if (parsed is ParseError) "{${seg.text}} — ${parsed.message}" else null
        }
