import type { AstNode } from "./ast";

/**
 * The root identifiers an expression reads — `{a.b + c[0]}` → `["a", "c"]`.
 *
 * A **Template** renders its source text when any of these is unbound, so a typo
 * stays visible in game instead of silently erasing the line (ADR
 * `expression-parity` §4). A **condition** does not: there, an unbound identifier
 * is legitimately `undefined` and coerces to false — the action-dsl conformance
 * vector depends on it. Hence this is a caller-side check rather than a behaviour
 * of `evaluate`.
 *
 * The set is a static property of the AST, so it is computed once and carried
 * alongside the parsed template rather than recomputed per row.
 */
export function rootIdentifiers(node: AstNode): string[] {
  const out = new Set<string>();
  walk(node, out);
  return [...out];
}

function walk(node: AstNode, out: Set<string>): void {
  switch (node.kind) {
    case "identifier":
      out.add(node.name);
      return;
    case "literal":
    case "papi":
      return;
    case "path":
      walk(node.target, out);
      return;
    case "index":
      walk(node.target, out);
      walk(node.index, out);
      return;
    case "method":
      walk(node.target, out);
      for (const arg of node.args) walk(arg, out);
      return;
    case "unary":
      walk(node.operand, out);
      return;
    case "binary":
      walk(node.left, out);
      walk(node.right, out);
      return;
    case "ternary":
      walk(node.cond, out);
      walk(node.whenTrue, out);
      walk(node.whenFalse, out);
      return;
  }
}
