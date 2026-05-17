import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage } from "react-konva";
import useImage from "use-image";

import { parseMiniMessage } from "@/lib/miniMessage";

/**
 * Advance widths (MC pixels, trimmed glyph width + 1 kerning gap)
 * computed from vanilla 1.21.4 ascii.png by scanning each 8×8 cell
 * for the rightmost non-transparent column.
 */
export const VANILLA_ADVANCES: Readonly<Record<string, number>> = {
  " ": 4,
  "!": 2, '"': 4, "#": 6, $: 6, "%": 6, "&": 6, "'": 2,
  "(": 4, ")": 4, "*": 4, "+": 6, ",": 2, "-": 6, ".": 2, "/": 6,
  "0": 6, "1": 6, "2": 6, "3": 6, "4": 6, "5": 6, "6": 6, "7": 6, "8": 6, "9": 6,
  ":": 2, ";": 2, "<": 5, "=": 6, ">": 5, "?": 6, "@": 7,
  A: 6, B: 6, C: 6, D: 6, E: 6, F: 6, G: 6, H: 6, I: 4,
  J: 6, K: 6, L: 6, M: 6, N: 6, O: 6, P: 6, Q: 6, R: 6,
  S: 6, T: 6, U: 6, V: 6, W: 6, X: 6, Y: 6, Z: 6,
  "[": 4, "\\": 6, "]": 6, "^": 4, _: 6, "`": 3,
  a: 6, b: 6, c: 6, d: 6, e: 6, f: 5, g: 6, h: 6, i: 2,
  j: 6, k: 5, l: 3, m: 6, n: 6, o: 6, p: 6, q: 6, r: 6,
  s: 6, t: 4, u: 6, v: 6, w: 6, x: 6, y: 6, z: 6,
  "{": 4, "|": 2, "}": 4, "~": 7,
};

/** Atlas cell size in the vanilla 128×128 ascii.png (8×8 per character). */
const ATLAS_CELL = 8;

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** URL of the vanilla MC ASCII font atlas served by the backend. */
const ATLAS_URL = `${API_URL}/api/textures/1.21.4/font/ascii`;

/** Map a printable ASCII char to its (col, row) cell in the atlas. */
function charCell(ch: string): { col: number; row: number } | null {
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) return null;
  return { col: code % 16, row: Math.floor(code / 16) };
}

interface VanillaMcTextProps {
  /** MiniMessage markup to render. */
  source: string;
  x: number;
  y: number;
  scale: number;
  /** Default text color when no MiniMessage color tag is active. */
  defaultColor?: string;
  listening?: boolean;
}

/**
 * Renders text using the vanilla MC ASCII bitmap atlas.
 *
 * Each character is cropped from the 128×128 atlas and tinted to the
 * active MiniMessage color using a reusable offscreen canvas. Advance
 * widths match MC's runtime behavior (trimmed glyph width + 1 kerning px).
 *
 * Non-ASCII characters and chars not in the atlas silently advance the
 * cursor by 6 MC pixels without rendering a glyph.
 *
 * Color tinting: the atlas has white glyphs on transparent background.
 * We apply `source-in` compositing to replace white with the desired
 * color, preserving the original per-pixel alpha.
 */
export function VanillaMcText({
  source,
  x,
  y,
  scale,
  defaultColor = "#404040",
  listening = false,
}: VanillaMcTextProps) {
  const [atlas] = useImage(ATLAS_URL, "anonymous");
  const tempRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState<{
    canvas: HTMLCanvasElement;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!atlas) return;
    const segments = parseMiniMessage(source);

    // Compute the total canvas width in canvas pixels.
    let totalWidth = 0;
    for (const seg of segments) {
      const bold = seg.style.bold ?? false;
      for (const ch of seg.text) {
        totalWidth += ((VANILLA_ADVANCES[ch] ?? 6) + (bold ? 1 : 0)) * scale;
      }
    }
    if (totalWidth <= 0) {
      setRendered(null);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(totalWidth);
    canvas.height = ATLAS_CELL * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Reuse a small offscreen canvas for per-glyph coloring.
    const cellPx = ATLAS_CELL * scale;
    if (!tempRef.current || tempRef.current.width !== cellPx) {
      tempRef.current = document.createElement("canvas");
      tempRef.current.width = cellPx;
      tempRef.current.height = cellPx;
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
        const advance = ((VANILLA_ADVANCES[ch] ?? 6) + (bold ? 1 : 0)) * scale;
        if (cell) {
          // Draw the white atlas glyph onto the temp canvas.
          tctx.clearRect(0, 0, cellPx, cellPx);
          tctx.drawImage(
            atlas,
            cell.col * ATLAS_CELL,
            cell.row * ATLAS_CELL,
            ATLAS_CELL,
            ATLAS_CELL,
            0,
            0,
            cellPx,
            cellPx,
          );
          // Tint: `source-in` keeps the glyph's alpha mask and replaces
          // the color with `color` (white × color = color).
          tctx.globalCompositeOperation = "source-in";
          tctx.fillStyle = color;
          tctx.fillRect(0, 0, cellPx, cellPx);
          tctx.globalCompositeOperation = "source-over";
          // Blit the tinted glyph to the main canvas. MC bold: draw twice,
          // second pass shifted 1px right (replicates MC's double-draw bold).
          ctx.drawImage(temp, cursor, 0);
          if (bold) ctx.drawImage(temp, cursor + scale, 0);
        }
        cursor += advance;
      }
    }

    setRendered({ canvas, width: Math.ceil(totalWidth) });
  }, [atlas, source, scale, defaultColor]);

  if (!rendered) return null;

  return (
    <Group x={x} y={y} listening={listening}>
      <KonvaImage
        image={rendered.canvas}
        x={0}
        y={0}
        width={rendered.width}
        height={ATLAS_CELL * scale}
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
  for (const ch of text) w += VANILLA_ADVANCES[ch] ?? 6;
  return w;
}
