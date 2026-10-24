import { NAMED_COLORS, type Style, plainTextFromMiniMessage } from "../miniMessage";
import { type VisibleUnit, richLayout, unitsBefore } from "./layout";
import {
  type MmElement,
  type MmNode,
  hasContent,
  nodeLength,
  parseTree,
  serialize,
  splitNodes,
  unwrap,
} from "./tree";

/**
 * The rich editor's operations, as pure functions on the source text. Each one only
 * rebuilds the nodes it touches and checks, before returning, that the displayed text
 * is unchanged (styles aside): an operation that would turn markup into visible text —
 * a stray `<` before an inserted tag, say — escapes those `<` or gives up.
 */
export interface MmEditResult {
  text: string;
  /** The same characters, in the new text. */
  selection: { from: number; to: number };
}

export type Decoration = "bold" | "italic" | "underlined" | "strikethrough" | "obfuscated";

const DECO_NAMES: Record<Decoration, string[]> = {
  bold: ["bold", "b"],
  italic: ["italic", "i", "em"],
  underlined: ["underlined", "u"],
  strikethrough: ["strikethrough", "st"],
  obfuscated: ["obfuscated", "obf"],
};

const COLOR_NAMES = new Set(["color", "gradient", "rainbow", "transition", "pride"]);
const isColorEl = (el: MmElement) =>
  COLOR_NAMES.has(el.name) || el.name in NAMED_COLORS || /^#[0-9a-f]{6}$/.test(el.name);
const isDecoEl = (d: Decoration) => (el: MmElement) =>
  DECO_NAMES[d].includes(el.name) || DECO_NAMES[d].includes(el.name.replace(/^!/, ""));
const INTERACTIVE = new Set(["click", "hover", "insert"]);

/** Every element that styles text, interactions included; not `<font>` or `<shadow>`. */
const isFormattingEl = (el: MmElement) =>
  isColorEl(el) ||
  (Object.keys(DECO_NAMES) as Decoration[]).some((d) => isDecoEl(d)(el)) ||
  INTERACTIVE.has(el.name) ||
  el.name === "shadow" ||
  el.name === "font";

interface Op {
  /** Whether an element spanning the whole range must be split rather than entered. */
  mustSplit: (el: MmElement) => boolean;
  transform: (middle: MmNode[]) => MmNode[];
}

function applyRange(nodes: MmNode[], from: number, to: number, op: Op, base: number): MmNode[] {
  let at = base;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k]!;
    const len = nodeLength(n);
    const contentStart = at + (n.kind === "el" ? n.open.length : 0);
    const contentEnd = n.kind === "el" ? at + len - (n.close?.length ?? 0) : at + len;
    if (n.kind === "el" && from >= contentStart && to <= contentEnd && !op.mustSplit(n)) {
      const children = applyRange(n.children, from, to, op, contentStart);
      return [...nodes.slice(0, k), { ...n, children }, ...nodes.slice(k + 1)];
    }
    at += len;
  }
  const [left, after] = splitNodes(nodes, to, base);
  const [before, middle] = splitNodes(left, from, base);
  return [...before, ...op.transform(middle), ...after];
}

/** Snaps a range onto the visible characters it covers; null when it covers none. */
function trim(units: VisibleUnit[], from: number, to: number): [number, number] | null {
  const inside = units.filter((u) => u.from < to && u.to > from);
  if (inside.length === 0) return null;
  return [inside[0]!.from, inside[inside.length - 1]!.to];
}

const escapeBareLt = (nodes: MmNode[]): MmNode[] =>
  nodes.map((n) => {
    if (n.kind === "el") return { ...n, children: escapeBareLt(n.children) };
    if (n.kind !== "text") return n;
    return { kind: "text", raw: n.raw.replace(/(^|[^\\])</g, "$1\\<") };
  });

/** Runs `op` on one fragment (one lore line); null when it cannot be done faithfully. */
function runOnFragment(src: string, from: number, to: number, op: Op): MmEditResult | null {
  const layout = richLayout(src);
  const range = trim(layout.units, from, to);
  if (!range) return null;
  const firstUnit = unitsBefore(layout.units, range[0]);
  const count = unitsBefore(layout.units, range[1]) - firstUnit;
  const plain = plainTextFromMiniMessage(src);
  const escaped = serialize(escapeBareLt(parseTree(src)));
  for (const source of escaped === src ? [src] : [src, escaped]) {
    const units = source === src ? layout.units : richLayout(source).units;
    const f = units[firstUnit]?.from;
    const t = units[firstUnit + count - 1]?.to;
    if (f === undefined || t === undefined) continue;
    const text = serialize(applyRange(parseTree(source), f, t, op, 0));
    if (plainTextFromMiniMessage(text) !== plain) continue;
    const after = richLayout(text).units;
    const a = after[firstUnit];
    const b = after[firstUnit + count - 1];
    return { text, selection: { from: a?.from ?? 0, to: b?.to ?? text.length } };
  }
  return null;
}

/**
 * Runs `op` on `[from, to)`. With `perLine` (a lore), each line is edited alone, since
 * each one is parsed alone in game.
 */
function run(src: string, from: number, to: number, op: Op, perLine: boolean): MmEditResult | null {
  if (!perLine || !src.includes("\n")) return runOnFragment(src, from, to, op);
  const lines = src.split("\n");
  let offset = 0;
  let changed = false;
  let selFrom = -1;
  let selTo = -1;
  const out: string[] = [];
  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;
    const outStart = out.reduce((s, l) => s + l.length + 1, 0);
    const res = from < end + 1 && to > start ? runOnFragment(line, from - start, to - start, op) : null;
    if (res) {
      changed = true;
      out.push(res.text);
      if (selFrom < 0) selFrom = outStart + res.selection.from;
      selTo = outStart + res.selection.to;
    } else out.push(line);
  }
  if (!changed) return null;
  return { text: out.join("\n"), selection: { from: selFrom, to: selTo } };
}

const wrapOp = (open: string, close: string, clear?: (el: MmElement) => boolean): Op => ({
  // An element the wrap replaces is split, not entered: a color is replaced, not nested.
  mustSplit: clear ?? (() => false),
  transform: (middle) => {
    const children = clear ? unwrap(middle, clear) : middle;
    const el: MmElement = { kind: "el", open, name: "", children, close };
    return children.some(hasContent) ? [el] : middle;
  },
});

const unwrapOp = (pred: (el: MmElement) => boolean): Op => ({
  mustSplit: pred,
  transform: (middle) => unwrap(middle, pred),
});

/** Whether every visible character of the range has `key` set. */
export function rangeHas(
  src: string,
  from: number,
  to: number,
  test: (s: Style) => boolean,
  perLine = false,
): boolean {
  const units = richLayout(src, perLine).units.filter(
    (u) => u.from < to && u.to > from && src.slice(u.from, u.to) !== "\n",
  );
  return units.length > 0 && units.every((u) => test(u.style));
}

export function toggleDecoration(
  src: string,
  from: number,
  to: number,
  deco: Decoration,
  perLine = false,
): MmEditResult | null {
  const on = rangeHas(src, from, to, (s) => s[deco] === true, perLine);
  const op = on ? unwrapOp(isDecoEl(deco)) : wrapOp(`<${deco}>`, `</${deco}>`, isDecoEl(deco));
  return run(src, from, to, op, perLine);
}

/** `#rrggbb` or a vanilla color name. */
export function setColor(src: string, from: number, to: number, color: string, perLine = false) {
  const named = color.toLowerCase() in NAMED_COLORS && !color.startsWith("#");
  const [open, close] = named
    ? [`<${color.toLowerCase()}>`, `</${color.toLowerCase()}>`]
    : [`<color:${color.toLowerCase()}>`, "</color>"];
  return run(src, from, to, wrapOp(open, close, isColorEl), perLine);
}

export function setGradient(
  src: string,
  from: number,
  to: number,
  stops: string[],
  perLine = false,
  phase?: number,
) {
  const args = [...stops.map((s) => s.toLowerCase()), ...(phase ? [String(phase)] : [])];
  return run(src, from, to, wrapOp(`<gradient:${args.join(":")}>`, "</gradient>", isColorEl), perLine);
}

export function removeColor(src: string, from: number, to: number, perLine = false) {
  return run(src, from, to, unwrapOp(isColorEl), perLine);
}

/** Quotes a tag argument for MiniMessage: `'…'`, inner quotes and backslashes escaped. */
export const quoteArg = (value: string): string =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export type ClickAction =
  | "open_url"
  | "run_command"
  | "suggest_command"
  | "copy_to_clipboard"
  | "change_page";

export function setClick(
  src: string,
  from: number,
  to: number,
  action: ClickAction,
  value: string,
  perLine = false,
) {
  const isClick = (el: MmElement) => el.name === "click";
  return run(
    src,
    from,
    to,
    wrapOp(`<click:${action}:${quoteArg(value)}>`, "</click>", isClick),
    perLine,
  );
}

/** `text` is itself MiniMessage: the hover may be styled. */
export function setHover(src: string, from: number, to: number, text: string, perLine = false) {
  const isHover = (el: MmElement) => el.name === "hover";
  return run(
    src,
    from,
    to,
    wrapOp(`<hover:show_text:${quoteArg(text)}>`, "</hover>", isHover),
    perLine,
  );
}

/** Wraps the range in an arbitrary pair (a palette style). */
export function wrapWith(
  src: string,
  from: number,
  to: number,
  open: string,
  close: string,
  perLine = false,
) {
  return run(src, from, to, wrapOp(open, close), perLine);
}

export function clearFormatting(src: string, from: number, to: number, perLine = false) {
  return run(src, from, to, unwrapOp(isFormattingEl), perLine);
}

/**
 * Deletes the visible characters of `[from, to)` and keeps the markup around them, so a
 * deletion never unbalances a tag. A pair left empty by the deletion goes with it.
 * Returns the text and where the caret lands.
 */
export function deleteVisible(
  src: string,
  from: number,
  to: number,
  perLine = false,
): { text: string; caret: number } {
  const layout = richLayout(src, perLine);
  const doomed = layout.units.filter((u) => u.from >= from && u.to <= to);
  if (doomed.length === 0) return { text: src, caret: from };
  const keepBefore = unitsBefore(layout.units, doomed[0]!.from);
  // Lines are deleted as characters (a lore's `\n` is a plain character).
  let text = "";
  let last = 0;
  const points: number[] = [];
  for (const u of doomed) {
    text += src.slice(last, u.from);
    points.push(text.length);
    last = u.to;
  }
  text += src.slice(last);
  text = dropEmptiedPairs(text, points, perLine);
  const units = richLayout(text, perLine).units;
  const prev = units[keepBefore - 1];
  const caret = prev ? prev.to : (units[0]?.from ?? Math.min(from, text.length));
  return { text, caret };
}

/** Removes the pairs a deletion at `points` left empty; other empty pairs are the user's. */
function dropEmptiedPairs(text: string, points: number[], perLine: boolean): string {
  if (!perLine) return serialize(prune(parseTree(text), 0, points));
  let offset = 0;
  return text
    .split("\n")
    .map((line) => {
      const local = points.map((p) => p - offset);
      offset += line.length + 1;
      return serialize(prune(parseTree(line), 0, local));
    })
    .join("\n");
}

function prune(nodes: MmNode[], base: number, points: number[]): MmNode[] {
  const out: MmNode[] = [];
  let at = base;
  for (const n of nodes) {
    const start = at;
    at += nodeLength(n);
    if (n.kind !== "el") {
      out.push(n);
      continue;
    }
    const contentStart = start + n.open.length;
    const contentEnd = at - (n.close?.length ?? 0);
    const children = prune(n.children, contentStart, points);
    const emptied =
      n.close !== null &&
      !children.some(hasContent) &&
      points.some((p) => p >= contentStart && p <= contentEnd);
    if (!emptied) out.push({ ...n, children });
  }
  return out;
}

/** Splits the line at `pos` for a lore: tags open there are closed, then reopened below. */
export function splitLine(src: string, pos: number): { text: string; caret: number } {
  const lineStart = src.lastIndexOf("\n", pos - 1) + 1;
  const nl = src.indexOf("\n", pos);
  const lineEnd = nl === -1 ? src.length : nl;
  const line = src.slice(lineStart, lineEnd);
  const [left, right] = splitNodes(parseTree(line), pos - lineStart);
  const l = serialize(left);
  const r = serialize(right);
  const text = `${src.slice(0, lineStart)}${l}\n${r}${src.slice(lineEnd)}`;
  const firstUnit = richLayout(r).units[0];
  return { text, caret: lineStart + l.length + 1 + (firstUnit?.from ?? r.length) };
}

/** The smallest single change turning `a` into `b`. */
export function diffText(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}
