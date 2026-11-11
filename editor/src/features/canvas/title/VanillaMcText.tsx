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
  const tempRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState<{
    canvas: HTMLCanvasElement;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!ascii || !accented || !nonlatin) return;
    const atlases: Record<AtlasName, HTMLImageElement> = {
      ascii,
      accented,
      nonlatin_european: nonlatin,
    };
    const segments = parseMiniMessage(source);

    // Compute the total canvas width in canvas pixels.
    let totalWidth = 0;
    for (const seg of segments) {
      const bold = seg.style.bold ?? false;
      for (const ch of seg.text) {
        totalWidth += (advance(ch) + (bold ? 1 : 0)) * scale * sizeScale;
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
      for (const ch of seg.text) {
        const cell = charCell(ch);
        // MC bold adds 1px to the advance (glyph drawn twice, shifted 1px right).
        const adv = (advance(ch) + (bold ? 1 : 0)) * scale * sizeScale;
        if (cell) {
          const meta = ATLAS_META[cell.atlas];
          const cw = meta.cellW * scale * sizeScale;
          const cellH = meta.cellH * scale * sizeScale;
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
          if (bold)
            ctx.drawImage(temp, 0, 0, cw, cellH, cursor + scale * sizeScale, yOffset, cw, cellH);
        }
        cursor += adv;
      }
    }

    setRendered({ canvas, width: Math.ceil(totalWidth) });
  }, [ascii, accented, nonlatin, source, scale, sizeScale, defaultColor]);

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
export function vanillaTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += advance(ch);
  return w;
}
