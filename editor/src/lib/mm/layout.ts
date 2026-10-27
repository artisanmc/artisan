import { templateSpans } from "../expr/template/tokenizer";
import {
  type Segment,
  type SourceSegment,
  type Style,
  parseMiniMessageSource,
} from "../miniMessage";

/** One thing the reader sees: a character (with its escape) or the text a tag shows. */
export interface VisibleUnit {
  from: number;
  to: number;
  style: Style;
  gen: boolean;
}

export interface RichLayout {
  /** Styled runs of literal text. */
  marks: { from: number; to: number; style: Style }[];
  /**
   * Tags that show text (`<newline>`, `<key:…>`), with what they show, and the
   * expressions shown whole (`expr`, their source as the one segment).
   */
  widgets: { from: number; to: number; segments: Segment[]; expr?: true }[];
  /** Markup: what the rich view hides. */
  hidden: { from: number; to: number }[];
  units: VisibleUnit[];
}

/**
 * Where everything in `src` comes from, for the rich view: the styled runs, the markup
 * to hide, the units the caret moves over. `perLine` parses each line alone (a lore).
 */
export function richLayout(src: string, perLine = false): RichLayout {
  // An expression is evaluated before MiniMessage: the tags in its strings are not the
  // text's. It is parsed as opaque filler, then shown whole, as one widget.
  const exprs = opaqueExpressions(src);
  let masked = src;
  for (const e of exprs) {
    masked =
      masked.slice(0, e.from) + src.slice(e.from, e.to).replace(/[^\n]/g, "x") + masked.slice(e.to);
  }
  const inExpr = new Uint8Array(src.length);
  for (const e of exprs) inExpr.fill(1, e.from, e.to);
  const segs: SourceSegment[] = parseMiniMessageSource(masked, perLine);
  const covered = new Uint8Array(src.length);
  const marks: RichLayout["marks"] = [];
  const widgets: RichLayout["widgets"] = [];
  const units: VisibleUnit[] = [];

  for (const seg of segs) {
    if (seg.gen) {
      const prev = widgets[widgets.length - 1];
      if (prev && prev.from === seg.gen.from && prev.to === seg.gen.to) {
        prev.segments.push({ text: seg.text, style: seg.style });
      } else {
        widgets.push({
          ...seg.gen,
          segments: [{ text: seg.text, style: seg.style }],
        });
        units.push({ ...seg.gen, style: seg.style, gen: true });
      }
      for (let k = seg.gen.from; k < seg.gen.to; k++) covered[k] = 2;
      continue;
    }
    let runFrom = -1;
    let runTo = -1;
    const flush = () => {
      if (runFrom >= 0) marks.push({ from: runFrom, to: runTo, style: seg.style });
      runFrom = -1;
    };
    for (const m of seg.map) {
      if (m < 0 || inExpr[m]) continue;
      covered[m] = 1;
      if (m === runTo) runTo = m + 1;
      else {
        flush();
        runFrom = m;
        runTo = m + 1;
      }
    }
    flush();
  }

  for (const e of exprs) {
    widgets.push({
      from: e.from,
      to: e.to,
      segments: [{ text: src.slice(e.from, e.to), style: {} }],
      expr: true,
    });
    units.push({ from: e.from, to: e.to, style: {}, gen: true });
    covered.fill(2, e.from, e.to);
  }
  widgets.sort((a, b) => a.from - b.from);

  for (const seg of segs) {
    if (seg.gen) continue;
    for (const m of seg.map) {
      if (m < 0 || inExpr[m]) continue;
      // An escaped character starts at its backslash.
      const from = m > 0 && src[m - 1] === "\\" && covered[m - 1] === 0 ? m - 1 : m;
      units.push({ from, to: m + 1, style: seg.style, gen: false });
    }
  }
  units.sort((a, b) => a.from - b.from);

  const hidden: RichLayout["hidden"] = [];
  let start = -1;
  for (let k = 0; k <= src.length; k++) {
    const isHidden = k < src.length && covered[k] === 0;
    if (isHidden && start < 0) start = k;
    if (!isHidden && start >= 0) {
      hidden.push({ from: start, to: k });
      start = -1;
    }
  }
  return { marks, widgets, hidden, units };
}

/**
 * The `{…}` the rich view cannot show as text: those with a space, a quote or a tag
 * (`{a ? "<red>x" : ""}`). A plain placeholder (`{player.name}`) stays editable text.
 */
function opaqueExpressions(src: string): { from: number; to: number }[] {
  return templateSpans(src).filter(
    (s) => s.kind === "expression" && /[\s"'<>]/.test(src.slice(s.from + 1, s.to - 1)),
  );
}

/** Number of units that end at or before `pos`. */
export function unitsBefore(units: VisibleUnit[], pos: number): number {
  let n = 0;
  for (const u of units) {
    if (u.to <= pos) n++;
    else break;
  }
  return n;
}

const lineBounds = (src: string, pos: number): [number, number] => {
  const start = src.lastIndexOf("\n", pos - 1) + 1;
  const nl = src.indexOf("\n", pos);
  return [start, nl === -1 ? src.length : nl];
};

/**
 * Where text typed at caret `pos` goes, like a word processor: right after the
 * character before it (so it takes that character's style), or, at the start of a
 * line, right before the first character (so it takes the line's opening style).
 */
export function insertionPoint(src: string, units: VisibleUnit[], pos: number): number {
  const [lineStart, lineEnd] = lineBounds(src, pos);
  const onLine = units.filter((u) => u.from >= lineStart && u.to <= lineEnd);
  // `\n` is a unit of its own in a joined text: never anchor on it.
  const visible = onLine.filter((u) => src.slice(u.from, u.to) !== "\n");
  if (visible.length === 0) return pos;
  let before: VisibleUnit | undefined;
  for (const u of visible) if (u.to <= pos) before = u;
  if (before) return before.to;
  return visible[0]!.from;
}
