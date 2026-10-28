import type { AstNode, BinaryOp } from "./ast";
import { parse } from "./parser";
import { templateSpans } from "./template/tokenizer";

/**
 * An expression read as rules a non-coder can follow: a list of parts shown one after
 * the other, where a part is a text, a value or a choice "if … show … otherwise …".
 * Only describes; the source stays the expression.
 */
export type Readable = { ok: true; parts: Part[] } | { ok: false; error: string };

export type Part =
  /** A string of the expression: MiniMessage, shown as in game. `at` is its source span. */
  | { kind: "text"; text: string; at: Span }
  | { kind: "value"; value: Value }
  | { kind: "choice"; cases: Case[]; otherwise: Part[] };

export interface Case {
  when: Cond;
  /** The condition as parsed, to tell which case the example player falls in. */
  test: AstNode;
  show: Part[];
}

export interface Span {
  from: number;
  to: number;
}

export type Value =
  | { kind: "var"; path: string }
  | { kind: "papi"; name: string }
  | { kind: "literal"; value: number | boolean | null }
  | { kind: "text"; text: string }
  | { kind: "method"; method: string; target: Value; args: Value[] }
  | { kind: "math"; op: "+" | "-"; left: Value; right: Value }
  | { kind: "cond"; cond: Cond }
  | { kind: "choice"; cases: Case[]; otherwise: Part[] };

export type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type Cond =
  | { kind: "is"; value: Value }
  | { kind: "not"; cond: Cond }
  | { kind: "compare"; op: CompareOp; left: Value; right: Value }
  | { kind: "all"; conds: Cond[] }
  | { kind: "any"; conds: Cond[] };

export function readExpression(src: string): Readable {
  let ast: AstNode;
  try {
    ast = parse(src);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, parts: partsOf(ast, src) };
}

/** `a + "b" + (c ? …)` reads as a list; `a + 1` stays a sum. */
function partsOf(node: AstNode, src: string): Part[] {
  if (node.kind === "binary" && node.op === "+") {
    const leaves = plusLeaves(node);
    if (leaves.some(isTextual)) return leaves.flatMap((leaf) => partsOf(leaf, src));
  }
  if (node.kind === "literal" && typeof node.value === "string") {
    return node.value === ""
      ? []
      : [{ kind: "text", text: node.value, at: stringSpan(src, node.pos) }];
  }
  if (node.kind === "ternary") return [{ kind: "choice", ...choiceOf(node, src) }];
  return [{ kind: "value", value: valueFrom(node, src) }];
}

function plusLeaves(node: AstNode): AstNode[] {
  if (node.kind === "binary" && node.op === "+") {
    return [...plusLeaves(node.left), ...plusLeaves(node.right)];
  }
  return [node];
}

function isTextual(node: AstNode): boolean {
  return (node.kind === "literal" && typeof node.value === "string") || node.kind === "ternary";
}

/** `a ? x : b ? y : z` is one choice with two cases, not choices nested in each other. */
function choiceOf(node: AstNode & { kind: "ternary" }, src: string) {
  const cases: Case[] = [];
  let rest: AstNode = node;
  while (rest.kind === "ternary") {
    cases.push({
      when: condOf(rest.cond, src),
      test: rest.cond,
      show: partsOf(rest.whenTrue, src),
    });
    rest = rest.whenFalse;
  }
  return { cases, otherwise: partsOf(rest, src) };
}

const LOGIC: Partial<Record<BinaryOp, "all" | "any">> = { "&&": "all", "||": "any" };

function condOf(node: AstNode, src: string): Cond {
  if (node.kind === "unary") return { kind: "not", cond: condOf(node.operand, src) };
  if (node.kind === "binary") {
    const logic = LOGIC[node.op];
    if (logic) {
      const conds = [node.left, node.right].flatMap((side) => {
        const c = condOf(side, src);
        return c.kind === logic ? c.conds : [c];
      });
      return { kind: logic, conds };
    }
    if (node.op !== "+" && node.op !== "-") {
      return {
        kind: "compare",
        op: node.op as CompareOp,
        left: valueFrom(node.left, src),
        right: valueFrom(node.right, src),
      };
    }
  }
  return { kind: "is", value: valueFrom(node, src) };
}

function valueFrom(node: AstNode, src: string): Value {
  switch (node.kind) {
    case "literal":
      return typeof node.value === "string"
        ? { kind: "text", text: node.value }
        : { kind: "literal", value: node.value };
    case "identifier":
    case "path":
    case "index": {
      const path = pathOf(node);
      if (path !== null) return { kind: "var", path };
      break;
    }
    case "papi":
      return { kind: "papi", name: node.placeholder };
    case "method":
      return {
        kind: "method",
        method: node.method,
        target: valueFrom(node.target, src),
        args: node.args.map((a) => valueFrom(a, src)),
      };
    case "ternary":
      return { kind: "choice", ...choiceOf(node, src) };
    case "unary":
      return { kind: "cond", cond: condOf(node, src) };
    case "binary":
      if (node.op === "+" || node.op === "-") {
        return {
          kind: "math",
          op: node.op,
          left: valueFrom(node.left, src),
          right: valueFrom(node.right, src),
        };
      }
      return { kind: "cond", cond: condOf(node, src) };
  }
  return { kind: "var", path: "?" };
}

/** `a.b[0].c`, or null when an index is not a plain number or word. */
function pathOf(node: AstNode): string | null {
  switch (node.kind) {
    case "identifier":
      return node.name;
    case "path": {
      const target = pathOf(node.target);
      return target === null ? null : `${target}.${node.field}`;
    }
    case "index": {
      const target = pathOf(node.target);
      const i = node.index;
      if (target === null || i.kind !== "literal") return null;
      return typeof i.value === "number" ? `${target}[${i.value}]` : `${target}["${i.value}"]`;
    }
    default:
      return null;
  }
}

/** Where the string literal starting at `pos` ends, its quotes included. */
function stringSpan(src: string, pos: number): Span {
  const quote = src[pos];
  let i = pos + 1;
  while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
  return { from: pos, to: i + 1 };
}

/** A text as a string literal of the expression, in the quotes `like` uses. */
export function quoteText(text: string, like = '"'): string {
  const q = like.startsWith("'") ? "'" : '"';
  const body = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(new RegExp(q, "g"), `\\${q}`);
  return `${q}${body}${q}`;
}

/**
 * The variables the `{…}` of a text read, in order, each once: what the "example player"
 * panel lets the user set. A method's target (`m.joined` of `m.joined.ago()`) is left out,
 * its value being a date or a list rather than something typed.
 */
export function variablesOf(text: string): string[] {
  const out = new Set<string>();
  const walk = (node: AstNode): void => {
    const path = pathOf(node);
    if (path !== null) {
      out.add(path);
      return;
    }
    switch (node.kind) {
      case "unary":
        walk(node.operand);
        break;
      case "binary":
        walk(node.left);
        walk(node.right);
        break;
      case "ternary":
        walk(node.cond);
        walk(node.whenTrue);
        walk(node.whenFalse);
        break;
      case "method":
        node.args.forEach(walk);
        break;
      case "index":
        walk(node.target);
        walk(node.index);
        break;
      case "path":
        walk(node.target);
        break;
    }
  };
  for (const span of templateSpans(text)) {
    if (span.kind !== "expression") continue;
    try {
      walk(parse(text.slice(span.from + 1, span.to - 1)));
    } catch {
      // An expression that does not parse sets nothing.
    }
  }
  return [...out];
}
