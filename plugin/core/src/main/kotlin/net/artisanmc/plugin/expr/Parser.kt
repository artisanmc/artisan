package net.artisanmc.plugin.expr

/**
 * Recursive-descent parser — mirror of `editor/src/lib/expr/parser.ts`, same
 * precedence ladder and the same error messages (the vector pins the ⚠️ prefix,
 * not the text, but keeping them identical helps when debugging across stacks).
 *
 * Precedence, loosest first: ternary → `||` → `&&` → `!` → comparison →
 * `+`/`-` → postfix (`.field`, `.method()`, `[i]`) → primary.
 *
 * Note there is no prefix minus: `-x` does not parse, `0 - x` does. That is the
 * TS grammar's shape and this mirror does not "fix" it.
 */
private class Parser(private val tokens: List<Token>) {
    private var i = 0

    private fun peek(): Token = tokens[i]

    private fun consume(kind: TokenKind, what: String? = null): Token {
        val t = tokens[i]
        if (t.kind != kind) {
            throw ParseError(
                "Expected ${what ?: kind.name} but got '${t.text.ifEmpty { t.kind.name }}' at column ${t.pos}",
                t.pos,
            )
        }
        i++
        return t
    }

    private fun match(kind: TokenKind): Token? {
        val t = tokens[i]
        if (t.kind == kind) {
            i++
            return t
        }
        return null
    }

    fun parseExpression(): Node {
        val node = ternary()
        if (peek().kind != TokenKind.EOF) {
            val t = peek()
            throw ParseError("Unexpected token '${t.text.ifEmpty { t.kind.name }}' at column ${t.pos}", t.pos)
        }
        return node
    }

    private fun ternary(): Node {
        val cond = orExpr()
        if (match(TokenKind.QUESTION) != null) {
            val whenTrue = ternary()
            consume(TokenKind.COLON, "':'")
            val whenFalse = ternary()
            return Node.Ternary(cond, whenTrue, whenFalse, cond.pos)
        }
        return cond
    }

    private fun orExpr(): Node {
        var node = andExpr()
        while (match(TokenKind.OR) != null) {
            node = Node.Binary("||", node, andExpr(), node.pos)
        }
        return node
    }

    private fun andExpr(): Node {
        var node = notExpr()
        while (match(TokenKind.AND) != null) {
            node = Node.Binary("&&", node, notExpr(), node.pos)
        }
        return node
    }

    private fun notExpr(): Node {
        val bang = match(TokenKind.BANG)
        if (bang != null) return Node.Unary("!", notExpr(), bang.pos)
        return compareExpr()
    }

    private fun compareExpr(): Node {
        val left = addExpr()
        val op = matchCompareOp() ?: return left
        return Node.Binary(op, left, addExpr(), left.pos)
    }

    private fun matchCompareOp(): String? {
        val op = when (peek().kind) {
            TokenKind.EQ -> "=="
            TokenKind.NEQ -> "!="
            TokenKind.LT -> "<"
            TokenKind.LTE -> "<="
            TokenKind.GT -> ">"
            TokenKind.GTE -> ">="
            else -> return null
        }
        i++
        return op
    }

    private fun addExpr(): Node {
        var node = postfix()
        while (true) {
            val t = peek()
            if (t.kind == TokenKind.PLUS || t.kind == TokenKind.MINUS) {
                i++
                node = Node.Binary(if (t.kind == TokenKind.PLUS) "+" else "-", node, postfix(), node.pos)
            } else {
                return node
            }
        }
    }

    private fun postfix(): Node {
        var node = primary()
        while (true) {
            if (match(TokenKind.DOT) != null) {
                val name = consume(TokenKind.IDENTIFIER, "field name")
                node = if (peek().kind == TokenKind.LPAREN) {
                    i++ // lparen
                    val args = mutableListOf<Node>()
                    if (peek().kind != TokenKind.RPAREN) {
                        args += ternary()
                        while (match(TokenKind.COMMA) != null) args += ternary()
                    }
                    consume(TokenKind.RPAREN, "')'")
                    Node.Method(node, name.text, args, node.pos)
                } else {
                    Node.Path(node, name.text, node.pos)
                }
            } else if (match(TokenKind.LBRACKET) != null) {
                val index = ternary()
                consume(TokenKind.RBRACKET, "']'")
                node = Node.Index(node, index, node.pos)
            } else {
                return node
            }
        }
    }

    private fun primary(): Node {
        val t = peek()
        when (t.kind) {
            TokenKind.NUMBER, TokenKind.STRING, TokenKind.TRUE, TokenKind.FALSE, TokenKind.NULL -> {
                i++
                return Node.Literal(t.value, t.pos)
            }
            TokenKind.PAPI -> {
                i++
                return Node.Papi(t.value as String, t.pos)
            }
            TokenKind.IDENTIFIER -> {
                i++
                return Node.Identifier(t.text, t.pos)
            }
            TokenKind.LPAREN -> {
                i++
                val inner = ternary()
                consume(TokenKind.RPAREN, "')'")
                return inner
            }
            else -> throw ParseError(
                "Unexpected token '${t.text.ifEmpty { t.kind.name }}' at column ${t.pos}",
                t.pos,
            )
        }
    }
}

/** Parse [src] into an AST. Throws [ParseError] — callers decide how tolerant to be. */
fun parseExpr(src: String): Node = Parser(tokenize(src)).parseExpression()
