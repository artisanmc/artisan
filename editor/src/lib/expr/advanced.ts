import type { AstNode } from "./ast";
import { parse } from "./parser";

/**
 * True when an expression uses what Artisan Pro helps with (docs/architecture/editions.md):
 * a method call, arithmetic (`+`, `-`) or a ternary. Reading a value (`{player.name}`), PAPI
 * and comparisons stay free. Only the editor's help is gated on it; the engine runs every
 * expression on both jars. An expression that does not parse is not advanced.
 */
export function isAdvancedExpression(source: string): boolean {
  let ast: AstNode;
  try {
    ast = parse(source.trim());
  } catch {
    return false;
  }
  return advanced(ast);
}

function advanced(node: AstNode): boolean {
  switch (node.kind) {
    case "method":
    case "ternary":
      return true;
    case "binary":
      return node.op === "+" || node.op === "-" || advanced(node.left) || advanced(node.right);
    case "unary":
      return advanced(node.operand);
    case "path":
      return advanced(node.target);
    case "index":
      return advanced(node.target) || advanced(node.index);
    default:
      return false;
  }
}
