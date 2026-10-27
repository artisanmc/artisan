import type { AstNode, BinaryOp } from "./ast";
import { quoteText } from "./readable";

/** How tightly each operator binds: a child binding less gets parentheses. */
const PREC: Record<BinaryOp, number> = {
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
};

function prec(node: AstNode): number {
  switch (node.kind) {
    case "ternary":
      return 1;
    case "binary":
      return PREC[node.op];
    case "unary":
      return 7;
    default:
      return 9;
  }
}

/** An expression's source back from its AST, parentheses only where needed. */
export function printExpression(node: AstNode): string {
  const wrap = (child: AstNode, min: number) => {
    const out = printExpression(child);
    return prec(child) < min ? `(${out})` : out;
  };
  switch (node.kind) {
    case "literal":
      return typeof node.value === "string" ? quoteText(node.value) : String(node.value);
    case "identifier":
      return node.name;
    case "path":
      return `${wrap(node.target, 9)}.${node.field}`;
    case "index":
      return `${wrap(node.target, 9)}[${printExpression(node.index)}]`;
    case "method":
      return `${wrap(node.target, 9)}.${node.method}(${node.args.map(printExpression).join(", ")})`;
    case "papi":
      return `%${node.placeholder}%`;
    case "unary":
      return `!${wrap(node.operand, 7)}`;
    case "binary": {
      const p = PREC[node.op];
      // Left-associative: the right side needs parentheses at the same level.
      return `${wrap(node.left, p)} ${node.op} ${wrap(node.right, p + 1)}`;
    }
    case "ternary":
      return `${wrap(node.cond, 2)} ? ${wrap(node.whenTrue, 1)} : ${wrap(node.whenFalse, 1)}`;
  }
}
