package net.artisanmc.plugin.actiondsl

import net.artisanmc.plugin.expr.ExprScope
import net.artisanmc.plugin.expr.evaluateExpr
import net.artisanmc.plugin.expr.parseExpr
import net.artisanmc.plugin.expr.toBooleanValue

/**
 * Leaf expression evaluation for the Action DSL (ADR `action-dsl` §6).
 *
 * A thin front to the one Expression engine ([net.artisanmc.plugin.expr]) rather
 * than a second parser (ADR `expression-parity`): a leaf may use the whole
 * vocabulary (methods, ternary, indexing).
 *
 * Two host-specific behaviours remain, and are why this file exists:
 *  - an unbound identifier resolves to `null` here, because a condition on a
 *    missing arg is legitimately false — whereas a **Template** renders its
 *    source text (ADR `expression-parity` §4);
 *  - [evalLeaf] swallows errors, since a condition must never crash a menu.
 */

/** Evaluate [expr] against [scope]; `null` on any error. [papi] resolves `%name%` (without %). */
fun evalLeaf(
    expr: String,
    scope: Map<String, Any?>,
    papi: ((String) -> String?)? = null,
): Any? = runCatching { evalLeafOrThrow(expr, scope, papi) }.getOrNull()

/**
 * Same as [evalLeaf] but propagates lex/parse errors so a caller can distinguish
 * a genuine parse failure from a legitimate `null` result (missing path, `null`
 * literal, unresolved `%papi%`). A missing path still resolves to `null`.
 */
fun evalLeafOrThrow(
    expr: String,
    scope: Map<String, Any?>,
    papi: ((String) -> String?)? = null,
): Any? = evaluateExpr(parseExpr(expr), ExprScope(scope, papi))

/**
 * Coerce a leaf value to Boolean — the shared coercion, so a condition and a
 * Template cannot disagree on what "truthy" means.
 */
fun toLeafBoolean(v: Any?): Boolean = toBooleanValue(v)
