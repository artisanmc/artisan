package net.artisanmc.plugin.stats

/**
 * Dimensions as stored (ADR `stats-foundation` ⑤): keys sorted, `k=v` joined by `&`, `%`, `&`
 * and `=` percent-escaped. Equal dimensions are equal strings, so a bucket's key is one column
 * on every dialect, and a query can group by it.
 */
object Dimensions {
    fun encode(dims: Map<String, String>): String =
        dims.entries.sortedBy { it.key }.joinToString("&") { (k, v) -> "${escape(k)}=${escape(v)}" }

    fun decode(text: String): Map<String, String> {
        if (text.isEmpty()) return emptyMap()
        return text.split('&').associate { pair ->
            val eq = pair.indexOf('=')
            if (eq < 0) unescape(pair) to "" else unescape(pair.substring(0, eq)) to unescape(pair.substring(eq + 1))
        }
    }

    /** A raw row's details as a JSON object of strings, keys sorted. */
    fun json(details: Map<String, String>): String =
        details.entries.sortedBy { it.key }.joinToString(",", "{", "}") { (k, v) -> "${quote(k)}:${quote(v)}" }

    private fun escape(s: String) = buildString(s.length) {
        for (c in s) when (c) {
            '%' -> append("%25")
            '&' -> append("%26")
            '=' -> append("%3D")
            else -> append(c)
        }
    }

    private fun unescape(s: String) = if ('%' !in s) s else s.replace("%26", "&").replace("%3D", "=").replace("%25", "%")

    private fun quote(s: String) = buildString(s.length + 2) {
        append('"')
        for (c in s) when {
            c == '"' -> append("\\\"")
            c == '\\' -> append("\\\\")
            c == '\n' -> append("\\n")
            c == '\r' -> append("\\r")
            c == '\t' -> append("\\t")
            c < ' ' -> append("\\u%04x".format(c.code))
            else -> append(c)
        }
        append('"')
    }
}
