package net.artisanmc.plugin.expr

/**
 * The root identifiers an expression reads — mirror of
 * `editor/src/lib/expr/rootIdentifiers.ts`.
 *
 * A Template renders its source when any of these is unbound (ADR
 * `expression-parity` §4); a condition does not — there an unbound name is
 * legitimately null. Hence a caller-side check rather than evaluator behaviour.
 *
 * Static per AST, so it is computed once at bundle load and carried with the
 * parsed template rather than recomputed for every rendered row.
 */
fun rootIdentifiers(node: Node): Set<String> {
    val out = LinkedHashSet<String>()
    walk(node, out)
    return out
}

private fun walk(node: Node, out: MutableSet<String>) {
    when (node) {
        is Node.Identifier -> out += node.name
        is Node.Literal, is Node.Papi -> Unit
        is Node.Path -> walk(node.target, out)
        is Node.Index -> { walk(node.target, out); walk(node.index, out) }
        is Node.Method -> { walk(node.target, out); node.args.forEach { walk(it, out) } }
        is Node.Unary -> walk(node.operand, out)
        is Node.Binary -> { walk(node.left, out); walk(node.right, out) }
        is Node.Ternary -> { walk(node.cond, out); walk(node.whenTrue, out); walk(node.whenFalse, out) }
    }
}
