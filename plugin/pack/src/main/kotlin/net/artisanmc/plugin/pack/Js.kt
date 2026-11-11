package net.artisanmc.plugin.pack

import java.math.BigDecimal

/**
 * The few JavaScript semantics the editor's pack builder relies on, so the Kotlin port writes the
 * same bytes: `JSON.stringify` (key order, escapes, number format, indent) and the loose
 * conversions (`String(x)`, `Number(x)`, truthiness) applied to parsed YAML.
 *
 * Values are what [Yaml.parse] returns: `Map<String, Any?>`, `List<Any?>`, `String`, `Number`,
 * `Boolean` or `null`. A missing key and a `null` value differ, as `undefined` and `null` do.
 */
internal object Js {
    /** `JSON.stringify(value)`, or with `indent` spaces as `JSON.stringify(value, null, indent)`. */
    fun stringify(value: Any?, indent: Int = 0): String = StringBuilder().also { write(it, value, indent, "") }.toString()

    fun stringifyBytes(value: Any?, indent: Int = 0): ByteArray = stringify(value, indent).toByteArray(Charsets.UTF_8)

    private fun write(out: StringBuilder, value: Any?, indent: Int, pad: String) {
        when (value) {
            null -> out.append("null")
            is String -> quote(out, value)
            is Boolean -> out.append(value)
            is Number -> out.append(number(value))
            is Map<*, *> -> {
                val keys = orderedKeys(value.keys.map { it.toString() })
                if (keys.isEmpty()) return run { out.append("{}") }
                val inner = pad + " ".repeat(indent)
                out.append('{')
                keys.forEachIndexed { i, key ->
                    if (i > 0) out.append(',')
                    if (indent > 0) out.append('\n').append(inner)
                    quote(out, key)
                    out.append(if (indent > 0) ": " else ":")
                    write(out, value[key], indent, inner)
                }
                if (indent > 0) out.append('\n').append(pad)
                out.append('}')
            }
            is Iterable<*> -> {
                val items = value.toList()
                if (items.isEmpty()) return run { out.append("[]") }
                val inner = pad + " ".repeat(indent)
                out.append('[')
                items.forEachIndexed { i, item ->
                    if (i > 0) out.append(',')
                    if (indent > 0) out.append('\n').append(inner)
                    write(out, item, indent, inner)
                }
                if (indent > 0) out.append('\n').append(pad)
                out.append(']')
            }
            else -> throw IllegalArgumentException("not a JSON value: ${value::class}")
        }
    }

    /** JavaScript's own-key order: integer-like keys first, ascending, then insertion order. */
    fun orderedKeys(keys: List<String>): List<String> {
        val (indices, names) = keys.partition { arrayIndex(it) != null }
        return indices.sortedBy { arrayIndex(it) } + names
    }

    private fun arrayIndex(key: String): Long? {
        if (key.isEmpty() || key.length > 10 || (key.length > 1 && key[0] == '0') || !key.all { it in '0'..'9' }) return null
        return key.toLong().takeIf { it < 4294967295L }
    }

    private fun quote(out: StringBuilder, s: String) {
        out.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\b' -> out.append("\\b")
                c == '\u000c' -> out.append("\\f")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c < ' ' -> out.append("\\u").append(String.format("%04x", c.code))
                c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> {
                    out.append(c).append(s[i + 1])
                    i++
                }
                c.isSurrogate() -> out.append("\\u").append(String.format("%04x", c.code))
                else -> out.append(c)
            }
            i++
        }
        out.append('"')
    }

    /** `Number.prototype.toString()`; `JSON.stringify` writes `null` for a non-finite number. */
    fun number(n: Number): String {
        if (n is Int || n is Long || n is Short || n is Byte) return n.toString()
        val d = n.toDouble()
        if (d.isNaN() || d.isInfinite()) return "null"
        return numberString(d)
    }

    /** `String(d)` for a finite number. */
    fun numberString(d: Double): String {
        if (d == 0.0) return "0"
        if (d == Math.rint(d) && Math.abs(d) < 1e21) return BigDecimal(d).toPlainString()
        // JDK 19+ prints the shortest decimal that round-trips, as JavaScript does.
        val shortest = BigDecimal(d.toString())
        val abs = Math.abs(d)
        if (abs >= 1e-6 && abs < 1e21) return shortest.stripTrailingZeros().toPlainString()
        val digits = shortest.unscaledValue().abs().toString().trimEnd('0').ifEmpty { "0" }
        val exponent = shortest.precision() - shortest.scale() - 1
        val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
        return (if (d < 0) "-" else "") + mantissa + "e" + (if (exponent >= 0) "+" else "-") + Math.abs(exponent)
    }

    // --- loose conversions -------------------------------------------------------------------

    fun isNumber(v: Any?): Boolean = v is Number

    fun num(v: Any?): Double? = (v as? Number)?.toDouble()

    /** `Number.isInteger(v)`. */
    fun isInteger(v: Any?): Boolean = num(v)?.let { !it.isInfinite() && it == Math.rint(it) } ?: false

    /** `Number.isSafeInteger(v)`. */
    fun isSafeInteger(v: Any?): Boolean = isInteger(v) && Math.abs(num(v)!!) <= 9007199254740991.0

    /** `String(v)`. */
    fun string(v: Any?): String = when (v) {
        null -> "null"
        is String -> v
        is Boolean -> v.toString()
        is Number -> v.toDouble().let { if (it.isNaN()) "NaN" else if (it.isInfinite()) (if (it > 0) "Infinity" else "-Infinity") else number(v) }
        is List<*> -> v.joinToString(",") { if (it == null) "" else string(it) }
        is Map<*, *> -> "[object Object]"
        else -> v.toString()
    }

    private val JS_SPACE = Regex("^[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+|[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$")

    /** `Number(v)`. */
    fun toNumber(v: Any?): Double = when (v) {
        null -> 0.0
        is Boolean -> if (v) 1.0 else 0.0
        is Number -> v.toDouble()
        is String -> {
            val s = v.replace(JS_SPACE, "")
            when {
                s.isEmpty() -> 0.0
                s.matches(Regex("[+-]?Infinity")) -> if (s.startsWith("-")) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
                s.matches(Regex("0[xX][0-9a-fA-F]+")) -> s.substring(2).toBigInteger(16).toDouble()
                s.matches(Regex("0[oO][0-7]+")) -> s.substring(2).toBigInteger(8).toDouble()
                s.matches(Regex("0[bB][01]+")) -> s.substring(2).toBigInteger(2).toDouble()
                s.matches(Regex("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")) -> s.toDouble()
                else -> Double.NaN
            }
        }
        is List<*> -> if (v.isEmpty()) 0.0 else if (v.size == 1) toNumber(string(v[0])) else Double.NaN
        else -> Double.NaN
    }

    /** JavaScript truthiness. */
    fun truthy(v: Any?): Boolean = when (v) {
        null -> false
        is Boolean -> v
        is Number -> v.toDouble().let { it != 0.0 && !it.isNaN() }
        is String -> v.isNotEmpty()
        else -> true
    }

    /** `String.fromCodePoint(cp)`: a `RangeError` for anything but an integer in 0..0x10FFFF. */
    fun fromCodePoint(cp: Double): String {
        require(cp == Math.rint(cp) && cp >= 0 && cp <= 0x10FFFF) { "Invalid code point $cp" }
        return String(Character.toChars(cp.toInt()))
    }
}

/**
 * YAML read as the editor's `yaml` package reads it: YAML 1.2, core schema. SnakeYAML only builds
 * the node tree; plain scalars are resolved here, because SnakeYAML and Jackson resolve them as
 * YAML 1.1 (`no` a boolean, `010` octal, `1_000` a number), which would build another pack.
 * Every number is a JavaScript number (a double). A duplicate key makes the file unreadable.
 */
internal object Yaml {
    private val NULL = Regex("^(?:~|[Nn]ull|NULL)?$")
    private val BOOL_TRUE = Regex("^(?:[Tt]rue|TRUE)$")
    private val BOOL_FALSE = Regex("^(?:[Ff]alse|FALSE)$")
    private val INT = Regex("^[-+]?[0-9]+$")
    private val OCT = Regex("^0o[0-7]+$")
    private val HEX = Regex("^0x[0-9a-fA-F]+$")
    private val INF = Regex("^[-+]?\\.(?:inf|Inf|INF)$")
    private val NAN = Regex("^\\.(?:nan|NaN|NAN)$")
    private val FLOAT_EXP = Regex("^[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)[eE][-+]?[0-9]+$")
    private val FLOAT = Regex("^[-+]?(?:\\.[0-9]+|[0-9]+\\.[0-9]*)$")

    /** The document, `null` when empty; throws on a file the editor would not read either. */
    fun parse(content: String): Any? {
        val loader = org.yaml.snakeyaml.Yaml(org.yaml.snakeyaml.LoaderOptions().apply { isAllowDuplicateKeys = false })
        val nodes = loader.composeAll(java.io.StringReader(content)).iterator()
        if (!nodes.hasNext()) return null
        val root = nodes.next()
        if (nodes.hasNext()) throw IllegalArgumentException("several documents")
        return value(root)
    }

    fun parseOrNull(content: String): Any? = runCatching { parse(content) }.getOrNull()

    private fun value(node: org.yaml.snakeyaml.nodes.Node): Any? = when (node) {
        is org.yaml.snakeyaml.nodes.ScalarNode -> scalar(node)
        is org.yaml.snakeyaml.nodes.SequenceNode -> node.value.map(::value)
        is org.yaml.snakeyaml.nodes.MappingNode -> {
            val out = LinkedHashMap<String, Any?>()
            for (tuple in node.value) {
                val key = value(tuple.keyNode).let { if (it is String) it else Js.string(it) }
                if (out.containsKey(key)) throw IllegalArgumentException("Map keys must be unique: $key")
                out[key] = value(tuple.valueNode)
            }
            out
        }
        else -> null
    }

    private fun scalar(node: org.yaml.snakeyaml.nodes.ScalarNode): Any? {
        val text = node.value
        if (node.scalarStyle != org.yaml.snakeyaml.DumperOptions.ScalarStyle.PLAIN) return text
        return when {
            NULL.matches(text) -> null
            BOOL_TRUE.matches(text) -> true
            BOOL_FALSE.matches(text) -> false
            INT.matches(text) -> text.toDouble()
            OCT.matches(text) -> text.substring(2).toBigInteger(8).toDouble()
            HEX.matches(text) -> text.substring(2).toBigInteger(16).toDouble()
            INF.matches(text) -> if (text.startsWith("-")) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
            NAN.matches(text) -> Double.NaN
            FLOAT_EXP.matches(text) || FLOAT.matches(text) -> text.toDouble()
            else -> text
        }
    }
}
