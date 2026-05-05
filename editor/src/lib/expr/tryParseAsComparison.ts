import type { AstNode } from "./ast";
import { parse } from "./parser";

export const COMPARISON_OPS = ["==", "!=", "<", "<=", ">", ">="] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

export interface Comparison {
  left: string;
  op: ComparisonOp;
  right: string;
}

const isComparisonOp = (op: string): op is ComparisonOp =>
  (COMPARISON_OPS as readonly string[]).includes(op);

/**
 * Walk a node and reproduce its source-text representation. Used to
 * convert each side of a comparison back to a string for the form
 * builder. We don't preserve the original source spans (ASTs strip
 * whitespace), so we re-emit canonical formatting.
 *
 * Limited to shapes that round-trip cleanly. If a shape isn't covered,
 * returns null and the caller falls back to free-text mode.
 */
function serializeNode(node: AstNode): string | null {
  switch (node.kind) {
    case "literal":
      if (node.value === null) return "null";
      if (typeof node.value === "string") return `"${node.value.replace(/"/g, '\\"')}"`;
      return String(node.value);
    case "identifier":
      return node.name;
    case "papi":
      return `%${node.placeholder}%`;
    case "path": {
      const target = serializeNode(node.target);
      return target === null ? null : `${target}.${node.field}`;
    }
    case "index": {
      const target = serializeNode(node.target);
      const index = serializeNode(node.index);
      return target === null || index === null ? null : `${target}[${index}]`;
    }
    case "method": {
      const target = serializeNode(node.target);
      if (target === null) return null;
      const args: string[] = [];
      for (const a of node.args) {
        const s = serializeNode(a);
        if (s === null) return null;
        args.push(s);
      }
      return `${target}.${node.method}(${args.join(", ")})`;
    }
    // ternary / unary / nested binary: too complex for the form, bail
    default:
      return null;
  }
}

/**
 * Try to interpret `expr` as a top-level comparison `<left> <op> <right>`.
 * Returns null when the expression is empty, unparseable, or shaped
 * differently (ternary, AND/OR, raw arithmetic, etc.).
 *
 * Both sides must serialize cleanly via serializeNode — this guarantees
 * the form will round-trip the user's input without losing information.
 */
export function tryParseAsComparison(expr: string): Comparison | null {
  const trimmed = expr.trim();
  if (trimmed === "") return null;
  let ast: AstNode;
  try {
    ast = parse(trimmed);
  } catch {
    return null;
  }
  if (ast.kind !== "binary") return null;
  if (!isComparisonOp(ast.op)) return null;
  const left = serializeNode(ast.left);
  const right = serializeNode(ast.right);
  if (left === null || right === null) return null;
  return { left, op: ast.op, right };
}

export function serializeComparison(c: Comparison): string {
  if (c.left.trim() === "" || c.right.trim() === "") return "";
  return `${c.left} ${c.op} ${c.right}`;
}
