package net.artisanmc.plugin.command

/**
 * A `run_command` text addressed to a module command (`boutique:buy "Diamond Sword" 2`):
 * the `namespace:name` ref, the text after it ([raw]) and its arguments ([argv]).
 */
data class ModuleCommandLine(val ref: String, val raw: String, val argv: List<String>) {
    companion object {
        private val REF = Regex("^[A-Za-z][A-Za-z0-9_]*:[A-Za-z][A-Za-z0-9_]*$")

        /**
         * Null unless the first word is a `namespace:name` ref among [registered]
         * (an exact match first, then ignoring case); [ref] is the registered spelling.
         */
        fun parse(command: String, registered: Set<String>): ModuleCommandLine? {
            val space = command.indexOf(' ')
            val head = if (space == -1) command else command.substring(0, space)
            if (!REF.matches(head)) return null
            val ref = if (head in registered) head else registered.firstOrNull { it.equals(head, ignoreCase = true) }
            ref ?: return null
            val raw = if (space == -1) "" else command.substring(space + 1)
            return ModuleCommandLine(ref, raw, splitArgs(raw))
        }

        /**
         * Splits on spaces; `"…"` keeps spaces together, with `\"` and `\\` as escapes.
         * Text with an unbalanced quote splits on spaces alone, as it did before quoting.
         */
        fun splitArgs(raw: String): List<String> = quoted(raw) ?: raw.split(' ', '\t').filter { it.isNotEmpty() }

        private fun quoted(raw: String): List<String>? {
            val out = mutableListOf<String>()
            val cur = StringBuilder()
            var inToken = false
            var inQuotes = false
            var i = 0
            while (i < raw.length) {
                val c = raw[i]
                when {
                    inQuotes && c == '\\' && i + 1 < raw.length && raw[i + 1] in "\"\\" -> {
                        cur.append(raw[i + 1])
                        i++
                    }
                    c == '"' -> {
                        inQuotes = !inQuotes
                        inToken = true
                    }
                    !inQuotes && (c == ' ' || c == '\t') -> {
                        if (inToken) out.add(cur.toString())
                        cur.clear()
                        inToken = false
                    }
                    else -> {
                        cur.append(c)
                        inToken = true
                    }
                }
                i++
            }
            if (inQuotes) return null
            if (inToken) out.add(cur.toString())
            return out
        }
    }
}
