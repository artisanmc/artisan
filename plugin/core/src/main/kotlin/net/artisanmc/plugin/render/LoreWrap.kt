package net.artisanmc.plugin.render

/**
 * Wraps one rendered lore line to `maxWidth` MC pixels (vanilla font advances,
 * +1 px per bold char). Words never split; a continuation line reopens the
 * tags still open where it starts, since each lore line is parsed alone.
 * `maxWidth <= 0` disables wrapping. Mirror of the editor's `lib/loreWrap.ts`,
 * locked by `testdata/lore-wrap-conformance.json`.
 */
object LoreWrap {
    private val TOKEN = Regex("<[^<>]*>|\\s+|[^\\s<]+|<")
    private val VOID_TAGS = setOf(
        "newline", "br", "lang", "tr", "translate", "lang_or", "tr_or", "translate_or",
        "key", "keybind", "selector", "sel", "score", "nbt", "data", "sprite", "head",
    )

    fun wrap(line: String, maxWidth: Int): List<String> {
        if (maxWidth <= 0 || line.isEmpty()) return listOf(line)
        val tokens = TOKEN.findAll(line).map { it.value }.toList()
        val stack = mutableListOf<String>()
        val out = mutableListOf<String>()
        val cur = StringBuilder()
        var curWidth = 0
        var curHasText = false
        var i = 0
        while (i < tokens.size) {
            val ws = StringBuilder()
            var wsWidth = 0
            while (i < tokens.size && isSpace(tokens[i])) {
                ws.append(tokens[i])
                wsWidth += width(tokens[i], isBold(stack))
                i++
            }
            if (i >= tokens.size) break
            val reopen = stack.joinToString("")
            val word = StringBuilder()
            var wordWidth = 0
            while (i < tokens.size && !isSpace(tokens[i])) {
                val tk = tokens[i]
                if (isTag(tk)) applyTag(stack, tk) else wordWidth += width(tk, isBold(stack))
                word.append(tk)
                i++
            }
            if (!curHasText || curWidth + wsWidth + wordWidth <= maxWidth) {
                cur.append(ws).append(word)
                curWidth += wsWidth + wordWidth
            } else {
                out.add(cur.toString())
                cur.setLength(0)
                cur.append(reopen).append(word)
                curWidth = wordWidth
            }
            if (wordWidth > 0) curHasText = true
        }
        out.add(cur.toString())
        return if (out.size == 1) listOf(line) else out
    }

    private fun isSpace(t: String) = t[0].isWhitespace()
    private fun isTag(t: String) = t.length > 2 && t.startsWith("<") && t.endsWith(">")
    private fun tagName(inner: String) = inner.substringBefore(':').trim().lowercase()

    private fun applyTag(stack: MutableList<String>, tag: String) {
        val inner = tag.substring(1, tag.length - 1)
        if (inner.startsWith("/")) {
            val name = tagName(inner.substring(1))
            val at = if (name.isEmpty()) stack.lastIndex
                else stack.indexOfLast { tagName(it.substring(1, it.length - 1)) == name }
            if (at >= 0) stack.removeAt(at)
            return
        }
        if (inner.endsWith("/")) return
        val name = tagName(inner)
        if (name == "reset") stack.clear() else if (name !in VOID_TAGS) stack.add(tag)
    }

    private fun isBold(stack: List<String>): Boolean {
        var bold = false
        for (e in stack) {
            val inner = e.substring(1, e.length - 1).lowercase()
            when (tagName(inner)) {
                "bold", "b" -> bold = !inner.endsWith(":false")
                "!bold", "!b" -> bold = false
            }
        }
        return bold
    }

    private fun width(text: String, bold: Boolean): Int =
        text.codePoints().toArray().sumOf { (CHAR_ADVANCES[it] ?: 1) + if (bold) 1 else 0 }
}
