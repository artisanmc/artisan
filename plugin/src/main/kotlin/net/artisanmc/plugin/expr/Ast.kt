package net.artisanmc.plugin.expr

/**
 * Expression AST — mirror of `editor/src/lib/expr/ast.ts`.
 *
 * The whole `expr` package is a faithful port of the editor's engine, locked by
 * `testdata/template-conformance.json` (ADR `expression-parity` §1). When the two
 * disagree, the TS side is authoritative and this one is the bug.
 */
sealed class Node {
    abstract val pos: Int

    data class Literal(val value: Any?, override val pos: Int) : Node()
    data class Identifier(val name: String, override val pos: Int) : Node()
    data class Papi(val placeholder: String, override val pos: Int) : Node()
    data class Path(val target: Node, val field: String, override val pos: Int) : Node()
    data class Index(val target: Node, val index: Node, override val pos: Int) : Node()
    data class Method(
        val target: Node,
        val method: String,
        val args: List<Node>,
        override val pos: Int,
    ) : Node()

    data class Unary(val op: String, val operand: Node, override val pos: Int) : Node()
    data class Binary(val op: String, val left: Node, val right: Node, override val pos: Int) : Node()
    data class Ternary(
        val cond: Node,
        val whenTrue: Node,
        val whenFalse: Node,
        override val pos: Int,
    ) : Node()
}

/** Thrown by the lexer and the parser; carries the column so the message matches the TS one. */
class ParseError(message: String, val pos: Int) : RuntimeException(message)
