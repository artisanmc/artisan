import { CHAR_ADVANCES } from "@/lib/mcFont/charAdvances";

/**
 * Wraps one rendered lore line to `maxWidth` MC pixels (vanilla font advances,
 * +1 px per bold char). Words never split; a continuation line reopens the
 * tags still open where it starts, since each lore line is parsed alone.
 * `maxWidth <= 0` disables wrapping. Mirror of the plugin's `LoreWrap.kt`,
 * locked by `testdata/lore-wrap-conformance.json`.
 */
export function wrapLore(line: string, maxWidth: number): string[] {
  return wrap(line, maxWidth).lines;
}

/** A MiniMessage line's width in MC pixels, as `wrapLore` measures it (tags take none). */
export function mcLineWidth(line: string): number {
  const stack: string[] = [];
  let w = 0;
  for (const tk of line.match(/<[^<>]*>|\s+|[^\s<]+|</g) ?? []) {
    if (isTag(tk)) applyTag(stack, tk);
    else w += width(tk, isBold(stack));
  }
  return w;
}

/**
 * Where `wrapLore` starts a new line, as offsets into `line`: the start of the word
 * that goes down (the spaces before it are dropped). Empty when the line fits.
 */
export function loreWrapPoints(line: string, maxWidth: number): number[] {
  return wrap(line, maxWidth).breaks;
}

function wrap(line: string, maxWidth: number): { lines: string[]; breaks: number[] } {
  if (maxWidth <= 0 || line === "") return { lines: [line], breaks: [] };
  const tokens = line.match(/<[^<>]*>|\s+|[^\s<]+|</g) ?? [];
  const stack: string[] = [];
  const out: string[] = [];
  const breaks: number[] = [];
  let pos = 0;
  let cur = "";
  let curWidth = 0;
  let curHasText = false;
  let i = 0;
  while (i < tokens.length) {
    let ws = "";
    let wsWidth = 0;
    while (i < tokens.length && isSpace(tokens[i]!)) {
      ws += tokens[i];
      wsWidth += width(tokens[i]!, isBold(stack));
      pos += tokens[i]!.length;
      i++;
    }
    if (i >= tokens.length) break;
    const reopen = stack.join("");
    const wordStart = pos;
    let word = "";
    let wordWidth = 0;
    while (i < tokens.length && !isSpace(tokens[i]!)) {
      const tk = tokens[i]!;
      if (isTag(tk)) applyTag(stack, tk);
      else wordWidth += width(tk, isBold(stack));
      word += tk;
      pos += tk.length;
      i++;
    }
    if (!curHasText || curWidth + wsWidth + wordWidth <= maxWidth) {
      cur += ws + word;
      curWidth += wsWidth + wordWidth;
    } else {
      out.push(cur);
      breaks.push(wordStart);
      cur = reopen + word;
      curWidth = wordWidth;
    }
    if (wordWidth > 0) curHasText = true;
  }
  out.push(cur);
  return out.length === 1 ? { lines: [line], breaks: [] } : { lines: out, breaks };
}

const VOID_TAGS = new Set([
  "newline",
  "br",
  "lang",
  "tr",
  "translate",
  "lang_or",
  "tr_or",
  "translate_or",
  "key",
  "keybind",
  "selector",
  "sel",
  "score",
  "nbt",
  "data",
  "sprite",
  "head",
]);

const isSpace = (t: string) => /^\s/.test(t);
const isTag = (t: string) => t.length > 2 && t.startsWith("<") && t.endsWith(">");
const tagName = (inner: string) => inner.split(":")[0]!.trim().toLowerCase();

function applyTag(stack: string[], tag: string): void {
  const inner = tag.slice(1, -1);
  if (inner.startsWith("/")) {
    const name = tagName(inner.slice(1));
    let at = stack.length - 1;
    if (name !== "") while (at >= 0 && tagName(stack[at]!.slice(1, -1)) !== name) at--;
    if (at >= 0) stack.splice(at, 1);
    return;
  }
  if (inner.endsWith("/")) return;
  const name = tagName(inner);
  if (name === "reset") stack.length = 0;
  else if (!VOID_TAGS.has(name)) stack.push(tag);
}

function isBold(stack: string[]): boolean {
  let bold = false;
  for (const e of stack) {
    const inner = e.slice(1, -1).toLowerCase();
    const name = tagName(inner);
    if (name === "bold" || name === "b") bold = !inner.endsWith(":false");
    else if (name === "!bold" || name === "!b") bold = false;
  }
  return bold;
}

function width(text: string, bold: boolean): number {
  let w = 0;
  for (const ch of text) w += (CHAR_ADVANCES[ch.codePointAt(0)!] ?? 1) + (bold ? 1 : 0);
  return w;
}
