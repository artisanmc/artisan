import { CHAR_ADVANCES } from "@/lib/mcFont/charAdvances";
import { ATLAS_META, type AtlasName, charCell } from "@/lib/mcFont/charCells";
import type { Segment, Style } from "@/lib/miniMessage";

/**
 * Draws MiniMessage segments with the vanilla bitmap font, the way the client does:
 * glyphs tinted per color, bold drawn twice 1 px apart, italic sheared, underline and
 * strikethrough as 1 px bars, and the drop shadow (the color at a quarter of its
 * brightness, 1 px down-right) under everything. Sizes are in MC pixels × `scale`.
 */
export type McAtlases = Record<AtlasName, HTMLImageElement>;

export const MAX_ASCENT = Math.max(
  ATLAS_META.ascii.ascent,
  ATLAS_META.accented.ascent,
  ATLAS_META.nonlatin_european.ascent,
);

/** Height of one drawn line, accents included, in MC pixels. */
export const LINE_BOX = Math.max(
  ATLAS_META.ascii.cellH + (MAX_ASCENT - ATLAS_META.ascii.ascent),
  ATLAS_META.accented.cellH + (MAX_ASCENT - ATLAS_META.accented.ascent),
  ATLAS_META.nonlatin_european.cellH + (MAX_ASCENT - ATLAS_META.nonlatin_european.ascent),
);

export function advance(ch: string): number {
  const cp = ch.codePointAt(0);
  return cp !== undefined ? (CHAR_ADVANCES[cp] ?? 1) : 1;
}

/** Width of a line in MC pixels (+1 per bold character). */
export function lineWidth(segments: Segment[], defaults: Style = {}): number {
  let w = 0;
  for (const seg of segments) {
    const bold = seg.style.bold ?? defaults.bold ?? false;
    for (const ch of seg.text) w += advance(ch) + (bold ? 1 : 0);
  }
  return w;
}

/** Splits segments on `\n` into lines. */
export function splitLines(segments: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];
  for (const seg of segments) {
    const parts = seg.text.split("\n");
    parts.forEach((text, k) => {
      if (k > 0) lines.push([]);
      if (text) lines[lines.length - 1]!.push({ text, style: seg.style });
    });
  }
  return lines;
}

const OBFUSCATION_POOL = Array.from({ length: 94 }, (_, k) => String.fromCharCode(33 + k));

/** A random glyph of the same width, as the client does for `<obfuscated>`. */
function obfuscate(ch: string, seed: number): string {
  const w = advance(ch);
  const same = OBFUSCATION_POOL.filter((c) => advance(c) === w);
  if (same.length === 0) return ch;
  return same[Math.abs(Math.floor(Math.sin(seed) * 10000)) % same.length]!;
}

const shadowOf = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) >> 2;
  const g = ((n >> 8) & 255) >> 2;
  const b = (n & 255) >> 2;
  return `rgb(${r},${g},${b})`;
};

const withAlpha = (hex: string, alpha: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export interface DrawOptions {
  defaults: Style;
  scale: number;
  shadow: boolean;
  /** Changes the obfuscated glyphs; bump it to animate them. */
  tick: number;
}

/**
 * Draws one line with its top-left at (x, y) on `ctx` (canvas pixels). The canvas must
 * have `imageSmoothingEnabled = false`.
 */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  atlases: McAtlases,
  segments: Segment[],
  x: number,
  y: number,
  opts: DrawOptions,
  tint: CanvasRenderingContext2D,
): void {
  const { scale, defaults } = opts;
  const passes: ("shadow" | "main")[] = opts.shadow ? ["shadow", "main"] : ["main"];
  for (const pass of passes) {
    let cursor = x;
    let index = 0;
    for (const seg of segments) {
      const s = { ...defaults, ...stripUndefined(seg.style) };
      const color = s.color ?? "#ffffff";
      const fill =
        pass === "main"
          ? color
          : s.shadow
            ? withAlpha(s.shadow.color, s.shadow.alpha)
            : shadowOf(color);
      const off = pass === "shadow" ? scale : 0;
      for (const original of seg.text) {
        const ch = s.obfuscated ? obfuscate(original, index * 31 + opts.tick) : original;
        index++;
        const bold = s.bold === true;
        const adv = (advance(ch) + (bold ? 1 : 0)) * scale;
        const cell = charCell(ch);
        if (cell) {
          const meta = ATLAS_META[cell.atlas];
          const cw = meta.cellW * scale;
          const chh = meta.cellH * scale;
          tint.clearRect(0, 0, tint.canvas.width, tint.canvas.height);
          tint.globalCompositeOperation = "source-over";
          tint.drawImage(
            atlases[cell.atlas],
            cell.col * meta.cellW,
            cell.row * meta.cellH,
            meta.cellW,
            meta.cellH,
            0,
            0,
            cw,
            chh,
          );
          tint.globalCompositeOperation = "source-in";
          tint.fillStyle = fill;
          tint.fillRect(0, 0, cw, chh);
          const top = y + (MAX_ASCENT - meta.ascent) * scale + off;
          const drawAt = (dx: number) => {
            if (s.italic) {
              // The client shears italic glyphs by a quarter pixel per pixel of height.
              const baseline = y + MAX_ASCENT * scale + off;
              ctx.save();
              ctx.setTransform(1, 0, -0.25, 1, 0.25 * baseline, 0);
              ctx.drawImage(tint.canvas, 0, 0, cw, chh, dx, top, cw, chh);
              ctx.restore();
            } else ctx.drawImage(tint.canvas, 0, 0, cw, chh, dx, top, cw, chh);
          };
          drawAt(cursor + off);
          if (bold) drawAt(cursor + off + scale);
        }
        ctx.fillStyle = fill;
        if (s.underlined) {
          ctx.fillRect(
            cursor + off - scale,
            y + (MAX_ASCENT + 1) * scale + off,
            adv + scale,
            scale,
          );
        }
        if (s.strikethrough) {
          ctx.fillRect(
            cursor + off - scale,
            y + (MAX_ASCENT - 3.5) * scale + off,
            adv + scale,
            scale,
          );
        }
        cursor += adv;
      }
    }
  }
}

function stripUndefined(style: Style): Style {
  const out: Style = {};
  for (const [k, v] of Object.entries(style)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Whether a line uses `<obfuscated>` (and so needs redrawing over time). */
export const hasObfuscated = (lines: Segment[][], defaults: Style): boolean =>
  lines.some((l) => l.some((s) => s.style.obfuscated ?? defaults.obfuscated));
