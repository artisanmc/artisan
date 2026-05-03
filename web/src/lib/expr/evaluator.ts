import type { AstNode } from "./ast";
import type { Scope } from "./scope";

/**
 * Evaluate an AST against a scope. Returns the runtime value (string,
 * number, boolean, null, undefined, array, or object). Caller is
 * responsible for any final coercion (e.g. toBoolean for condition.expr,
 * toStringValue for inline template segments).
 *
 * Errors are NOT thrown for missing data (we return undefined) — this
 * matches the runtime philosophy of "tolerant by default" in spec §3.4.
 * Type errors (e.g. .join on a number) are signaled by returning a safe
 * default; the caller may surface them in the editor's lint pass.
 */
export function evaluate(node: AstNode, scope: Scope): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "identifier":
      return scope.lookup(node.name);
    case "papi":
      return scope.papi(node.placeholder);
    case "path": {
      const target = evaluate(node.target, scope);
      if (target === null || target === undefined) return undefined;
      if (typeof target !== "object") return undefined;
      return (target as Record<string, unknown>)[node.field];
    }
    case "index": {
      const target = evaluate(node.target, scope);
      const index = evaluate(node.index, scope);
      if (target === null || target === undefined) return undefined;
      if (Array.isArray(target)) {
        const n = typeof index === "number" ? index : Number(index);
        return Number.isInteger(n) ? target[n] : undefined;
      }
      if (typeof target === "object") {
        return (target as Record<string, unknown>)[String(index)];
      }
      return undefined;
    }
    default:
      throw new Error(`evaluator: kind '${(node as { kind: string }).kind}' not yet implemented`);
  }
}
