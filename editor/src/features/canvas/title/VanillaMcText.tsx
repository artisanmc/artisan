import symbolsAtlasUrl from "@/assets/minecraft/font/symbols.png";
import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage } from "react-konva";
import useImage from "use-image";

import { CHAR_ADVANCES } from "@/lib/mcFont/charAdvances";
import { ATLAS_META, type AtlasName, charCell } from "@/lib/mcFont/charCells";
import { parseMiniMessage } from "@/lib/miniMessage";

/**
 * Per-character advance lookup. Backed by the generated CHAR_ADVANCES map
 * (built from vanilla MC ascii.png + accented.png + nonlatin_european.png).
 * Falls back to 1 — MC's empty-cell default — for codepoints not in the
 * table (rare scripts, emojis, etc.).
 */
function advance(ch: string): number {
  const cp = ch.codePointAt(0);
  return cp !== undefined ? (CHAR_ADVANCES[cp] ?? 1) : 1;
}

import { API_URL } from "@/lib/api/client";

const ATLAS_URLS: Record<AtlasName, string> = {
  ascii: `${API_URL}/api/v1/textures/1.21.4/font/ascii`,
  accented: `${API_URL}/api/v1/textures/1.21.4/font/accented`,
  nonlatin_european: `${API_URL}/api/v1/textures/1.21.4/font/nonlatin_european`,
  // Unifont symbols (gen-symbols.ts), shipped with the editor: the pack carries the used ones.
  symbols: symbolsAtlasUrl,
};

// All atlases share the same ascent reference: the canvas's top-of-line is
// placed at chest-y 6 (vanilla title position). Each char is drawn so its
// baseline sits at `MAX_ASCENT` from the canvas top.
const MAX_ASCENT = Math.max(
  ATLAS_META.ascii.ascent,
  ATLAS_META.accented.ascent,
  ATLAS_META.nonlatin_european.ascent,
);
// Canvas height covers the tallest possible cell, anchored so baselines align.
const CANVAS_H_SRC = Math.max(
  ATLAS_META.ascii.cellH + (MAX_ASCENT - ATLAS_META.ascii.ascent),
  ATLAS_META.accented.cellH + (MAX_ASCENT - ATLAS_META.accented.ascent),
  ATLAS_META.nonlatin_european.cellH + (MAX_ASCENT - ATLAS_META.nonlatin_european.ascent),
);

interface VanillaMcTextProps {
  /** MiniMessage markup to render. */
  source: string;
  x: number;
  y: number;
  scale: number;
  /** Multiplier applied to glyph dimensions only (not coordinates). Defaults
   *  to 1, meaning vanilla 8-px height. Plugin's `size=16` text uses 2 here. */
  sizeScale?: number;
  /** Default text color when no MiniMessage color tag is active. */
  defaultColor?: string;
  listening?: boolean;
}

/**
 * Renders text using the vanilla MC bitmap atlases (ascii + accented +
 * nonlatin_european). Each glyph is cropped from the atlas that owns it
 * (per vanilla provider priority), tinted to the active MiniMessage color,
 * and blitted with a per-atlas vertical offset so baselines align across
 * cells of different heights.
 *
 * Color tinting uses `source-in` compositing: the atlas glyph (white on
 * transparent) becomes a mask, and the active color fills it while
 * preserving per-pixel alpha.
 */
export function VanillaMcText({
  source,
  x,
  y,
  scale,
  sizeScale = 1,
  defaultColor = "#404040",
  listening = false,
}: VanillaMcTextProps) {
  const [ascii] = useImage(ATLAS_URLS.ascii, "anonymous");
  const [accented] = useImage(ATLAS_URLS.accented, "anonymous");
  const [nonlatin] = useImage(ATLAS_URLS.nonlatin_european, "anonymous");
  const [symbols] = useImage(ATLAS_URLS.symbols);
  const tempRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState<{
    canvas: HTMLCanvasElement;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!ascii || !accented || !nonlatin || !symbols) return;
    const atlases: Record<AtlasName, HTMLImageElement> = {
      ascii,
      accented,
      nonlatin_european: nonlatin,
      symbols,
    };
    const segments = parseMiniMessage(source);

    // Compute the total canvas width in canvas pixels.
    let totalWidth = 0;
    for (const seg of segments) {
      const bold = seg.style.bold ?? false;
      for (const ch of seg.text) {
        // MC bold adds 1 px whatever the font's size.
        totalWidth += (scaledAdvance(ch, sizeScale) + (bold ? 1 : 0)) * scale;
      }
    }
    if (totalWidth <= 0) {
      setRendered(null);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(totalWidth);
    canvas.height = CANVAS_H_SRC * scale * sizeScale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Reuse a small offscreen canvas for per-glyph coloring. Sized to the
    // tallest possible cell so any atlas glyph fits.
    const tempW =
      Math.max(
        ATLAS_META.ascii.cellW,
        ATLAS_META.accented.cellW,
        ATLAS_META.nonlatin_european.cellW,
      ) *
      scale *
      sizeScale;
    const tempH =
      Math.max(
        ATLAS_META.ascii.cellH,
        ATLAS_META.accented.cellH,
        ATLAS_META.nonlatin_european.cellH,
      ) *
      scale *
      sizeScale;
    if (!tempRef.current || tempRef.current.width !== tempW || tempRef.current.height !== tempH) {
      tempRef.current = document.createElement("canvas");
      tempRef.current.width = tempW;
      tempRef.current.height = tempH;
    }
    const temp = tempRef.current;
    const tctx = temp.getContext("2d")!;
    tctx.imageSmoothingEnabled = false;

    let cursor = 0;
    for (const seg of segments) {
      const color = seg.style.color ?? defaultColor;
      const bold = seg.style.bold ?? false;
      const segStart = cursor;
      for (const ch of seg.text) {
        const cell = charCell(ch);
        // MC bold adds 1px to the advance (glyph drawn twice, shifted 1px right).
        const adv = (scaledAdvance(ch, sizeScale) + (bold ? 1 : 0)) * scale;
        if (cell) {
          const meta = ATLAS_META[cell.atlas];
          const cw = meta.cellW * meta.px * scale * sizeScale;
          const cellH = meta.cellH * meta.px * scale * sizeScale;
          // Vertical offset to align baselines: top of this glyph's cell is
          // placed `MAX_ASCENT - meta.ascent` source pixels below the canvas
          // top, so its baseline lands at MAX_ASCENT — same as every other
          // glyph regardless of which atlas it came from.
          const yOffset = (MAX_ASCENT - meta.ascent) * scale * sizeScale;
          // Draw the white atlas glyph onto the temp canvas.
          tctx.clearRect(0, 0, tempW, tempH);
          tctx.drawImage(
            atlases[cell.atlas],
            cell.col * meta.cellW,
            cell.row * meta.cellH,
            meta.cellW,
            meta.cellH,
            0,
            0,
            cw,
            cellH,
          );
          // Tint: `source-in` keeps the glyph's alpha mask and replaces
          // the color with `color` (white × color = color).
          tctx.globalCompositeOperation = "source-in";
          tctx.fillStyle = color;
          tctx.fillRect(0, 0, cw, cellH);
          tctx.globalCompositeOperation = "source-over";
          // Blit the tinted glyph to the main canvas. MC bold: draw twice,
          // second pass shifted 1px right.
          ctx.drawImage(temp, 0, 0, cw, cellH, cursor, yOffset, cw, cellH);
          if (bold) ctx.drawImage(temp, 0, 0, cw, cellH, cursor + scale, yOffset, cw, cellH);
        }
        cursor += adv;
      }
      // Underline / strikethrough as the plugin draws them on a title text (bars of its font,
      // TitleCompiler.decoratedBody): from 1 px before the span to its end, one text height
      // below the top for the underline, half of it for the strikethrough, a pixel of the font thick.
      const top = (MAX_ASCENT - ATLAS_META.ascii.ascent) * scale * sizeScale;
      ctx.fillStyle = color;
      for (const [on, row] of [
        [seg.style.underlined, 8],
        [seg.style.strikethrough, 4],
      ] as const) {
        if (!on) continue;
        const from = Math.max(0, segStart - scale);
        ctx.fillRect(from, top + row * scale * sizeScale, cursor - from, scale * sizeScale);
      }
    }

    setRendered({ canvas, width: Math.ceil(totalWidth) });
  }, [ascii, accented, nonlatin, symbols, source, scale, sizeScale, defaultColor]);

  if (!rendered) return null;

  // Callers position `y` against the top of an ASCII cell (the pre-multi-atlas
  // anchor). The canvas top sits `(MAX_ASCENT - ascii.ascent)` source pixels
  // above that anchor so accent rows (which need a taller cell) can extend
  // upward without being clipped.
  const groupY = y - (MAX_ASCENT - ATLAS_META.ascii.ascent) * scale * sizeScale;

  return (
    <Group x={x} y={groupY} listening={listening}>
      <KonvaImage
        image={rendered.canvas}
        x={0}
        y={0}
        width={rendered.width}
        height={CANVAS_H_SRC * scale * sizeScale}
        listening={false}
      />
    </Group>
  );
}

/**
 * Compute the rendered width of a plain string in MC pixels using the
 * vanilla advance table. Useful for hit-area sizing.
 */
/**
 * Advance of a glyph in a font `sizeScale` × the vanilla height, as Minecraft lays it out: a
 * bitmap glyph of width `w` advances `(int)(0.5 + w × scale) + 1`, a space `4 × scale`.
 */
export function scaledAdvance(ch: string, sizeScale: number): number {
  if (sizeScale === 1) return advance(ch);
  return ch === " "
    ? Math.trunc(4 * sizeScale)
    : Math.trunc((advance(ch) - 1) * sizeScale + 0.5) + 1;
}

export function vanillaTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += advance(ch);
  return w;
}
