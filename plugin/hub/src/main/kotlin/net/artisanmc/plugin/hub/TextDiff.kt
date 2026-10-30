package net.artisanmc.plugin.hub

/**
 * A unified diff of one text file, for a model or a person to read what a deploy changes
 * (`draft_publish`, ADR `mcp-server`): hunks with [CONTEXT] lines around each change. Files too
 * large to compare line by line come back as their whole removal and addition, cut at [maxLines].
 */
object TextDiff {
    private const val CONTEXT = 2
    /** Lines × lines above which the comparison table would cost too much: the whole file is replaced instead. */
    private const val MAX_CELLS = 4_000_000L

    fun unified(before: String?, after: String?, maxLines: Int = 400): String {
        val a = lines(before)
        val b = lines(after)
        val ops = if (a.size.toLong() * b.size > MAX_CELLS) a.map { '-' to it } + b.map { '+' to it } else ops(a, b)
        val out = StringBuilder()
        var written = 0
        for (hunk in hunks(ops)) {
            out.append("@@ -${hunk.aStart + 1},${hunk.aCount} +${hunk.bStart + 1},${hunk.bCount} @@\n")
            for ((op, line) in hunk.lines) {
                if (written++ == maxLines) return out.append("… (diff cut at $maxLines lines)\n").toString()
                out.append(op).append(line).append('\n')
            }
        }
        return out.toString()
    }

    private fun lines(text: String?): List<String> = text?.removeSuffix("\n")?.takeIf { text.isNotEmpty() }?.split('\n') ?: emptyList()

    /** The edit script: `' '` kept, `'-'` removed, `'+'` added, by the longest common subsequence. */
    private fun ops(a: List<String>, b: List<String>): List<Pair<Char, String>> {
        val n = a.size
        val m = b.size
        val lcs = Array(n + 1) { IntArray(m + 1) }
        for (i in n - 1 downTo 0) for (j in m - 1 downTo 0)
            lcs[i][j] = if (a[i] == b[j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
        val out = ArrayList<Pair<Char, String>>(n + m)
        var i = 0
        var j = 0
        while (i < n && j < m) when {
            a[i] == b[j] -> { out += ' ' to a[i]; i++; j++ }
            lcs[i + 1][j] >= lcs[i][j + 1] -> out += '-' to a[i++]
            else -> out += '+' to b[j++]
        }
        while (i < n) out += '-' to a[i++]
        while (j < m) out += '+' to b[j++]
        return out
    }

    private class Hunk(val aStart: Int, val bStart: Int, val lines: List<Pair<Char, String>>) {
        val aCount get() = lines.count { it.first != '+' }
        val bCount get() = lines.count { it.first != '-' }
    }

    private fun hunks(ops: List<Pair<Char, String>>): List<Hunk> {
        val changed = ops.indices.filter { ops[it].first != ' ' }
        if (changed.isEmpty()) return emptyList()
        // Changes closer than twice the context share a hunk.
        val ranges = mutableListOf<IntRange>()
        var start = changed.first()
        var end = start
        for (k in changed.drop(1)) {
            if (k - end > 2 * CONTEXT) { ranges += start..end; start = k }
            end = k
        }
        ranges += start..end
        return ranges.map { range ->
            val from = (range.first - CONTEXT).coerceAtLeast(0)
            val to = (range.last + CONTEXT).coerceAtMost(ops.lastIndex)
            val before = ops.subList(0, from)
            Hunk(before.count { it.first != '+' }, before.count { it.first != '-' }, ops.subList(from, to + 1))
        }
    }
}
