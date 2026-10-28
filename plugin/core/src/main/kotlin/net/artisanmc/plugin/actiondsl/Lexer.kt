package net.artisanmc.plugin.actiondsl

/**
 * Action DSL lexer. Language-symmetric port of `editor/src/lib/actionDsl/lexer.ts`.
 * Splits source into logical lines (blank + `#`-comment lines dropped) carrying
 * their indentation depth and a flat token list. Indentation is significant; a
 * trailing `:` on a header line becomes a COLON token. A `project:id` reference
 * (`open_menu shop:main`) lexes as one WORD.
 */

enum class TokenType { WORD, NUMBER, STRING, KEY, PAPI, OP, COLON }

data class Token(val type: TokenType, val value: String, val col: Int)

data class LogicalLine(val indent: Int, val tokens: List<Token>, val line: Int)

class DslLexError(message: String, val line: Int, val col: Int) :
    RuntimeException("$message (line $line, col $col)")

private val WORD_RE = Regex("[A-Za-z_][A-Za-z0-9_.]*")
/** A project folder name (`my-shop`, `2024`), `:`, then an id. */
private val REF_RE = Regex("[A-Za-z0-9][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_.]*")
private val KEY_RE = Regex("@[A-Za-z0-9_][A-Za-z0-9_.]*")
private val PAPI_RE = Regex("%[A-Za-z_][A-Za-z0-9_]*%")
private val NUMBER_RE = Regex("[0-9]+(?:\\.[0-9]+)?")

private val TWO_CHAR_OPS = setOf("==", "!=", "<=", ">=")
private val ONE_CHAR_OPS = setOf("=", "<", ">", "(", ")", ",", "+", "-")

fun lex(source: String): List<LogicalLine> {
    val out = mutableListOf<LogicalLine>()
    val rawLines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    rawLines.forEachIndexed { i, raw ->
        val lineNo = i + 1
        val indent = raw.length - raw.trimStart().length
        val content = stripComment(raw)
        if (content.trim().isEmpty()) return@forEachIndexed
        val tokens = tokenizeLine(content, lineNo)
        if (tokens.isNotEmpty()) out.add(LogicalLine(indent, tokens, lineNo))
    }
    return out
}

/** Remove a `#` comment, honoring `"..."` strings so `#` inside text survives. */
private fun stripComment(raw: String): String {
    var inStr = false
    for (i in raw.indices) {
        val c = raw[i]
        if (c == '"' && (i == 0 || raw[i - 1] != '\\')) inStr = !inStr
        else if (c == '#' && !inStr) return raw.substring(0, i)
    }
    return raw
}

private fun tokenizeLine(content: String, line: Int): List<Token> {
    val tokens = mutableListOf<Token>()
    var i = 0
    val n = content.length
    while (i < n) {
        val c = content[i]
        if (c == ' ' || c == '\t') {
            i++
            continue
        }
        if (c == ':' && content.substring(i + 1).trim().isEmpty()) {
            tokens.add(Token(TokenType.COLON, ":", i + 1))
            break
        }
        if (c == '"') {
            val (value, next) = readString(content, i, line)
            tokens.add(Token(TokenType.STRING, value, i + 1))
            i = next
            continue
        }
        if (c == '@') {
            val m = KEY_RE.matchAt(content, i)
                ?: throw DslLexError("Malformed @key", line, i + 1)
            tokens.add(Token(TokenType.KEY, m.value.substring(1), i + 1))
            i = m.range.last + 1
            continue
        }
        if (c == '%') {
            val m = PAPI_RE.matchAt(content, i)
                ?: throw DslLexError("Malformed %placeholder%", line, i + 1)
            tokens.add(Token(TokenType.PAPI, m.value, i + 1))
            i = m.range.last + 1
            continue
        }
        if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9') {
            val m = REF_RE.matchAt(content, i)
            if (m != null) {
                tokens.add(Token(TokenType.WORD, m.value, i + 1))
                i = m.range.last + 1
                continue
            }
        }
        if (c in '0'..'9') {
            val m = NUMBER_RE.matchAt(content, i)
            if (m != null) {
                tokens.add(Token(TokenType.NUMBER, m.value, i + 1))
                i = m.range.last + 1
                continue
            }
        }
        val two = if (i + 2 <= n) content.substring(i, i + 2) else ""
        if (TWO_CHAR_OPS.contains(two)) {
            tokens.add(Token(TokenType.OP, two, i + 1))
            i += 2
            continue
        }
        if (ONE_CHAR_OPS.contains(c.toString())) {
            tokens.add(Token(TokenType.OP, c.toString(), i + 1))
            i++
            continue
        }
        if (c in 'A'..'Z' || c in 'a'..'z' || c == '_') {
            val m = WORD_RE.matchAt(content, i)
            if (m != null) {
                tokens.add(Token(TokenType.WORD, m.value, i + 1))
                i = m.range.last + 1
                continue
            }
        }
        throw DslLexError("Unexpected character '$c'", line, i + 1)
    }
    return tokens
}

private data class StringRead(val value: String, val next: Int)

private fun readString(content: String, start: Int, line: Int): StringRead {
    val out = StringBuilder()
    var i = start + 1
    while (i < content.length) {
        val c = content[i]
        if (c == '\\') {
            val nxt = if (i + 1 < content.length) content[i + 1] else null
            out.append(
                when (nxt) {
                    'n' -> "\n"
                    't' -> "\t"
                    null -> ""
                    else -> nxt.toString()
                },
            )
            i += 2
            continue
        }
        if (c == '"') return StringRead(out.toString(), i + 1)
        out.append(c)
        i++
    }
    throw DslLexError("Unterminated string", line, start + 1)
}
