package net.artisanmc.plugin.expr

/**
 * Identifier bag with an optional parent chain and PAPI resolution — mirror of
 * `editor/src/lib/expr/scope.ts`.
 */
class ExprScope(
    private val bag: Map<String, Any?>,
    private val papiResolver: ((String) -> String?)? = null,
    private val parent: ExprScope? = null,
    /** Wall clock in epoch millis — injected so `until()` is testable and pinnable. */
    private val clock: (() -> Long)? = null,
    /** Translation lookup, for the `artisan.*` presentation keys. */
    private val translator: ((String) -> String?)? = null,
) {
    /** Bound anywhere in the chain? Distinct from being bound to null. */
    fun has(name: String): Boolean =
        bag.containsKey(name) || (parent?.has(name) ?: false)

    fun lookup(name: String): Any? =
        if (bag.containsKey(name)) bag[name] else parent?.lookup(name)

    fun papi(name: String): String =
        (papiResolver ?: parent?.papiResolver)?.invoke(name) ?: ""

    fun now(): Long = (clock ?: parent?.clock)?.invoke() ?: System.currentTimeMillis()

    fun translate(key: String): String? = (translator ?: parent?.translator)?.invoke(key)

    fun child(extra: Map<String, Any?>): ExprScope =
        ExprScope(extra, papiResolver, this, clock, translator)
}

/**
 * Evaluate [node] against [scope] — mirror of `editor/src/lib/expr/evaluator.ts`.
 *
 * Type errors are values, not exceptions: `.join` on a number yields `""`, a
 * field of a non-object yields `null`. The runtime never crashes a menu.
 */
fun evaluateExpr(node: Node, scope: ExprScope): Any? = when (node) {
    is Node.Literal -> node.value
    is Node.Identifier -> scope.lookup(node.name)
    is Node.Papi -> scope.papi(node.placeholder)

    is Node.Path -> {
        val target = evaluateExpr(node.target, scope)
        when (target) {
            null -> null
            is Map<*, *> -> target[node.field]
            else -> memberOf(target, node.field)
        }
    }

    is Node.Index -> {
        val target = evaluateExpr(node.target, scope)
        val index = evaluateExpr(node.index, scope)
        when (target) {
            null -> null
            is List<*> -> {
                val n = toNumberOrNull(index)
                if (n != null && n == Math.floor(n)) target.getOrNull(n.toInt()) else null
            }
            is Map<*, *> -> target[toStringValue(index)]
            else -> null
        }
    }

    is Node.Method -> invokeMethod(
        evaluateExpr(node.target, scope),
        node.method,
        node.args.map { evaluateExpr(it, scope) },
        scope,
    )

    is Node.Unary -> !toBooleanValue(evaluateExpr(node.operand, scope))

    is Node.Binary -> when (node.op) {
        // Short-circuit, and always Boolean — mirrors the TS.
        "&&" -> if (toBooleanValue(evaluateExpr(node.left, scope)))
            toBooleanValue(evaluateExpr(node.right, scope)) else false
        "||" -> if (toBooleanValue(evaluateExpr(node.left, scope))) true
            else toBooleanValue(evaluateExpr(node.right, scope))
        else -> {
            val left = evaluateExpr(node.left, scope)
            val right = evaluateExpr(node.right, scope)
            when (node.op) {
                "+" -> if (left is String || right is String) {
                    toStringValue(left) + toStringValue(right)
                } else {
                    val ln = toNumberOrNull(left)
                    val rn = toNumberOrNull(right)
                    if (ln != null && rn != null) ln + rn else null
                }
                "-" -> if (left is String) null else {
                    val ln = toNumberOrNull(left)
                    val rn = toNumberOrNull(right)
                    if (ln != null && rn != null) ln - rn else null
                }
                "==" -> looseEq(left, right)
                "!=" -> !looseEq(left, right)
                "<", "<=", ">", ">=" -> compareValues(left, right, node.op)
                else -> null
            }
        }
    }

    is Node.Ternary -> if (toBooleanValue(evaluateExpr(node.cond, scope)))
        evaluateExpr(node.whenTrue, scope) else evaluateExpr(node.whenFalse, scope)
}

/**
 * The closed method vocabulary (ADR `expression-parity` §9 — every entry has a
 * row in `docs-site/.../editor/expressions.md` and in the conformance vector).
 * An unknown method yields `null`, like the TS.
 */
private fun invokeMethod(target: Any?, method: String, args: List<Any?>, scope: ExprScope): Any? = when (method) {
    "join" -> {
        if (target !is List<*>) "" else {
            val sep = if (args.isEmpty() || args[0] == null) "" else toStringValue(args[0])
            target.joinToString(sep) { if (it == null) "" else toStringValue(it) }
        }
    }
    "length" -> when (target) {
        null -> 0.0
        is List<*> -> target.size.toDouble()
        is String -> target.length.toDouble()
        else -> 0.0
    }
    "first" -> (target as? List<*>)?.firstOrNull()
    "last" -> (target as? List<*>)?.lastOrNull()
    "at" -> {
        val list = target as? List<*>
        val n = toNumberOrNull(args.getOrNull(0))
        if (list == null || n == null || n != Math.floor(n)) null else list.getOrNull(n.toInt())
    }
    "contains" -> (target as? List<*>)?.any { it == args.getOrNull(0) } ?: false
    "pluck" -> {
        if (target !is List<*>) emptyList<Any?>() else {
            val field = if (args.isEmpty() || args[0] == null) "" else toStringValue(args[0])
            target.map { if (it is Map<*, *>) it[field] else memberOf(it, field) }
        }
    }
    "until" -> {
        // The target is an absolute instant (epoch millis) — the row carries the
        // fact, the Template decides how it reads (ADR `expression-parity` §6).
        val at = toNumberOrNull(target)
        if (at == null) "" else Duration.format(at.toLong() - scope.now()) { scope.translate(it) }
    }
    "ago" -> {
        // The mirror of until(): time elapsed since a past instant (`{player.last_seen.ago()}`).
        val at = toNumberOrNull(target)
        if (at == null) "" else Duration.format(scope.now() - at.toLong()) { scope.translate(it) }
    }
    "duration" -> {
        // A length of time in milliseconds (`{player.playtime.duration()}`), same units as until().
        val ms = toNumberOrNull(target)
        if (ms == null) "" else Duration.format(ms.toLong()) { scope.translate(it) }
    }
    else -> null
}

/**
 * Field access on a non-Map value. The runtime binds live objects (a Bukkit
 * `Player`) where the editor binds plain maps, so the few fields a menu may read
 * from them are surfaced here rather than leaking Bukkit into the evaluator.
 */
private fun memberOf(target: Any?, field: String): Any? =
    (target as? ExprMember)?.exprMember(field)

/** Implemented by runtime objects a Template may read fields from. */
interface ExprMember {
    fun exprMember(field: String): Any?
}
