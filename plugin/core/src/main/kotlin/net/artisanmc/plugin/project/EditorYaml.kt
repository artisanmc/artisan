package net.artisanmc.plugin.project

/**
 * YAML as the editor's writer prints it (`yaml` with `lineWidth: 0`), for the shapes a
 * generated command holds: maps, lists, strings and booleans. Block maps and lists, a list
 * item's map starting on its dash, `[]` for an empty list; a string plain unless the YAML core
 * schema would read it as something else or a plain scalar cannot hold it, then double-quoted.
 */
object EditorYaml {
    fun write(root: Map<String, Any?>): String = StringBuilder().also { map(it, root, 0) }.toString()

    private fun map(out: StringBuilder, map: Map<String, Any?>, indent: Int, firstInline: Boolean = false) {
        var first = firstInline
        for ((key, value) in map) {
            if (value == null) continue
            if (!first) out.append(" ".repeat(indent))
            first = false
            out.append(key).append(':')
            entry(out, value, indent)
        }
    }

    /** After `key:` or `-`: a scalar on the line, a block below it. */
    private fun entry(out: StringBuilder, value: Any, indent: Int) {
        when {
            value is Map<*, *> && value.isNotEmpty() -> {
                out.append('\n')
                @Suppress("UNCHECKED_CAST")
                map(out, value as Map<String, Any?>, indent + 2)
            }
            value is List<*> && value.isNotEmpty() -> {
                out.append('\n')
                list(out, value, indent + 2)
            }
            value is List<*> -> out.append(" []\n")
            value is Map<*, *> -> out.append(" {}\n")
            else -> out.append(' ').append(scalar(value)).append('\n')
        }
    }

    private fun list(out: StringBuilder, list: List<*>, indent: Int) {
        for (item in list) {
            out.append(" ".repeat(indent)).append('-')
            when {
                item is Map<*, *> && item.isNotEmpty() -> {
                    out.append(' ')
                    @Suppress("UNCHECKED_CAST")
                    map(out, item as Map<String, Any?>, indent + 2, firstInline = true)
                }
                item is List<*> && item.isNotEmpty() -> {
                    out.append('\n')
                    list(out, item, indent + 2)
                }
                else -> entry(out, item ?: "", indent)
            }
        }
    }

    fun scalar(value: Any): String = when (value) {
        is Boolean, is Number -> value.toString()
        else -> value.toString().let { if (plain(it)) it else quoted(it) }
    }

    /** What the YAML 1.2 core schema reads as other than a string. */
    private val NOT_A_STRING = Regex(
        "^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE" +
            "|[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+" +
            "|[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?" +
            "|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$",
    )

    private fun plain(s: String): Boolean {
        if (s.isEmpty() || s != s.trim()) return false
        if (NOT_A_STRING.matches(s)) return false
        // An indicator first, or `-`, `?`, `:` followed by a space or alone.
        if (s[0] in ",[]{}#&*!|>'\"%@`") return false
        if (s[0] in "-?:" && (s.length == 1 || s[1] == ' ' || s[1] == '\t')) return false
        if (s.contains(": ") || s.contains(" #") || s.endsWith(":")) return false
        if (s.any { it == '\n' || it == '\t' || it < ' ' }) return false
        // A flow indicator anywhere is fine in a block context; a document marker is not.
        if (s.startsWith("---") || s.startsWith("...")) return false
        return true
    }

    private fun quoted(s: String): String = buildString {
        append('"')
        for (c in s) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\t' -> append("\\t")
            else -> if (c < ' ') append("\\x%02X".format(c.code)) else append(c)
        }
        append('"')
    }
}
