import type { AstNode } from "./ast";
import { parse } from "./parser";
import { printExpression } from "./print";

const isText = (n: AstNode): n is AstNode & { kind: "literal"; value: string } =>
  n.kind === "literal" && typeof n.value === "string";

function plusLeaves(node: AstNode): AstNode[] {
  return node.kind === "binary" && node.op === "+"
    ? [...plusLeaves(node.left), ...plusLeaves(node.right)]
    : [node];
}

/**
 * A computed lore text written as one `{…}` glued with `"\n"` (`{a + (c ? "\nX" : "")…}`),
 * rewritten as one line per rule: `{c ? "X" : ""}` on its own line, which the plugin
 * leaves out when it gives nothing. A break shown only under a condition (`c ? "\n" : ""`)
 * becomes a plain empty line. Null when there is nothing to split.
 */
export function splitIntoLines(inner: string): string[] | null {
  let ast: AstNode;
  try {
    ast = parse(inner);
  } catch {
    return null;
  }
  const lines: AstNode[][] = [];
  let current: AstNode[] = [];
  const breakLine = () => {
    lines.push(current);
    current = [];
  };
  const text = (value: string, pos: number): AstNode => ({ kind: "literal", value, pos });
  for (const leaf of plusLeaves(ast)) {
    if (isText(leaf)) {
      leaf.value.split("\n").forEach((segment, i) => {
        if (i > 0) breakLine();
        if (segment) current.push(text(segment, leaf.pos));
      });
      continue;
    }
    if (leaf.kind === "ternary" && isText(leaf.whenTrue) && isText(leaf.whenFalse)) {
      const [shown, hidden] =
        leaf.whenFalse.value === ""
          ? (["whenTrue", "whenFalse"] as const)
          : (["whenFalse", "whenTrue"] as const);
      const value = (leaf[shown] as { value: string }).value;
      if ((leaf[hidden] as { value: string }).value === "" && value.startsWith("\n")) {
        breakLine();
        const rest = value.slice(1);
        if (rest.includes("\n") || rest === "") {
          // A conditional blank line: kept as a plain one.
          if (rest !== "") current.push({ ...leaf, [shown]: text(rest, leaf.pos) });
          continue;
        }
        current.push({ ...leaf, [shown]: text(rest, leaf.pos) });
        continue;
      }
    }
    current.push(leaf);
  }
  lines.push(current);
  if (lines.length < 2) return null;
  return lines.map((parts) =>
    parts.map((p) => (isText(p) ? p.value : `{${printExpression(p)}}`)).join(""),
  );
}
