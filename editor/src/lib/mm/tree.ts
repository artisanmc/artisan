import { SELF_REPLACING, type SourceSegment, parseMiniMessageSource } from "../miniMessage";

/**
 * A lossless tree over one MiniMessage fragment: `serialize(parseTree(s)) === s` for any
 * input. Which `<…>` are markup is decided by the preview parser (what its segments do
 * not cover), so the tree and the rendering never disagree; everything else is text,
 * kept byte for byte — escapes, unknown tags, a lone `<`.
 *
 * The rich editor never re-serializes a text it did not change: operations rebuild only
 * the nodes they touch, every other node keeps its raw source.
 */
export type MmNode = MmText | MmVoid | MmElement;

export interface MmText {
  kind: "text";
  raw: string;
}

/** A tag with no content: `<reset>`, `<newline>`, `<key:…>`… */
export interface MmVoid {
  kind: "void";
  raw: string;
  name: string;
  /** True when the tag displays text (a placeholder, a line break). */
  shows: boolean;
}

export interface MmElement {
  kind: "el";
  open: string;
  /** Name a closing tag must carry: `gold`, `bold`, `color` for `<c:…>`… */
  name: string;
  children: MmNode[];
  /** Null when the source never closes it (it runs to the end, or to a `<reset>`). */
  close: string | null;
}

const VOID = new Set(["reset", "newline", "br", "br/", ...SELF_REPLACING]);

/** The name a tag is closed by — the preview parser's stack name. */
export function tagName(raw: string): { name: string; closing: boolean } {
  const head = (raw.slice(1, -1).toLowerCase().split(":")[0] ?? "").trim();
  const closing = head.startsWith("/");
  const bare = closing ? head.slice(1) : head;
  const name = bare === "colour" || bare === "c" ? "color" : bare;
  return { name, closing };
}

interface Token {
  from: number;
  to: number;
  gen: boolean;
}

/** The markup tokens of `src`, as the preview parser sees them. */
export function markupTokens(src: string, segments?: SourceSegment[]): Token[] {
  const segs = segments ?? parseMiniMessageSource(src);
  const covered = new Uint8Array(src.length);
  const gens = new Map<number, number>();
  for (const seg of segs) {
    for (const m of seg.map) if (m >= 0) covered[m] = 1;
    if (seg.gen) gens.set(seg.gen.from, seg.gen.to);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const genTo = gens.get(i);
    if (genTo !== undefined) {
      tokens.push({ from: i, to: genTo, gen: true });
      i = genTo;
      continue;
    }
    if (src[i] === "<" && !covered[i]) {
      const close = src.indexOf(">", i + 1);
      if (close !== -1) {
        tokens.push({ from: i, to: close + 1, gen: false });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return tokens;
}

export function parseTree(src: string): MmNode[] {
  const root: MmNode[] = [];
  const stack: MmElement[] = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.children : root);
  let last = 0;
  const text = (to: number) => {
    if (to > last) top().push({ kind: "text", raw: src.slice(last, to) });
  };
  for (const tk of markupTokens(src)) {
    text(tk.from);
    last = tk.to;
    const raw = src.slice(tk.from, tk.to);
    const { name, closing } = tagName(raw);
    if (tk.gen) {
      top().push({ kind: "void", raw, name, shows: true });
    } else if (closing) {
      let at = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k]!.name === name) {
          at = k;
          break;
        }
      }
      if (at === -1) top().push({ kind: "text", raw });
      else {
        stack[at]!.close = raw;
        stack.length = at;
      }
    } else if (VOID.has(name)) {
      top().push({ kind: "void", raw, name, shows: false });
      if (name === "reset") stack.length = 0;
    } else {
      const el: MmElement = { kind: "el", open: raw, name, children: [], close: null };
      top().push(el);
      stack.push(el);
    }
  }
  text(src.length);
  return root;
}

export function serialize(nodes: MmNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "el") out += n.open + serialize(n.children) + (n.close ?? "");
    else out += n.raw;
  }
  return out;
}

export const nodeLength = (n: MmNode): number =>
  n.kind === "el"
    ? n.open.length + n.children.reduce((s, c) => s + nodeLength(c), 0) + (n.close?.length ?? 0)
    : n.raw.length;

/** True when the node displays something: a character, a placeholder. */
export function hasContent(n: MmNode): boolean {
  if (n.kind === "text") return n.raw.length > 0;
  if (n.kind === "void") return n.shows;
  return n.children.some(hasContent);
}

/**
 * Cut points inside a text node's raw: never inside an escape (`\<`), a literal tag
 * (`<wat>`) or a surrogate pair. Returns the largest cut point ≤ `at`.
 */
export function floorCut(raw: string, at: number): number {
  let i = 0;
  let prev = 0;
  while (i < raw.length && i <= at) {
    prev = i;
    const ch = raw[i]!;
    if (ch === "\\" && i + 1 < raw.length) i += 2;
    else if (ch === "<") {
      const close = raw.indexOf(">", i + 1);
      i = close === -1 ? i + 1 : close + 1;
    } else {
      const cp = raw.codePointAt(i) ?? 0;
      i += cp > 0xffff ? 2 : 1;
    }
  }
  return i <= at ? i : prev;
}

/** The closing tag a split element gets on its left part. */
export const closeFor = (el: MmElement): string => el.close ?? `</${el.name}>`;

/**
 * Splits a node list at source offset `pos` (relative to `base`), cloning every element
 * that spans it: `<b>ab|cd</b>` → `<b>ab</b>` + `<b>cd</b>`. A part left without content
 * by the split is dropped, so no empty pair is created.
 */
export function splitNodes(nodes: MmNode[], pos: number, base = 0): [MmNode[], MmNode[]] {
  const left: MmNode[] = [];
  const right: MmNode[] = [];
  let at = base;
  for (const n of nodes) {
    const len = nodeLength(n);
    const start = at;
    const end = at + len;
    at = end;
    if (end <= pos) left.push(n);
    else if (start >= pos) right.push(n);
    else if (n.kind === "text") {
      const cut = floorCut(n.raw, pos - start);
      if (cut > 0) left.push({ kind: "text", raw: n.raw.slice(0, cut) });
      if (cut < n.raw.length) right.push({ kind: "text", raw: n.raw.slice(cut) });
    } else if (n.kind === "void") {
      // A tag is never cut: it goes wherever its start is.
      right.push(n);
    } else {
      const contentStart = start + n.open.length;
      const [lc, rc] = splitNodes(n.children, pos, contentStart);
      const l: MmElement = { ...n, children: lc, close: closeFor(n) };
      const r: MmElement = { ...n, children: rc };
      if (lc.some(hasContent)) left.push(l);
      if (rc.some(hasContent) || !lc.some(hasContent)) right.push(r);
    }
  }
  return [left, right];
}

/** Replaces each element matching `pred` by its children, at every depth. */
export function unwrap(nodes: MmNode[], pred: (el: MmElement) => boolean): MmNode[] {
  const out: MmNode[] = [];
  for (const n of nodes) {
    if (n.kind !== "el") out.push(n);
    else if (pred(n)) out.push(...unwrap(n.children, pred));
    else out.push({ ...n, children: unwrap(n.children, pred) });
  }
  return out;
}
