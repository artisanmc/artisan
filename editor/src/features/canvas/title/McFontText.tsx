import type { Asset } from "@/domain/asset";
import { useAuthenticatedImage } from "@/lib/useAuthenticatedImage";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import { fontGlyphUrl } from "./fontGlyphUrl";

/**
 * Width (in MC pixels) reserved for a missing glyph. Roughly matches the
 * vanilla MC space advance so layouts don't visually collapse when a char
 * is undefined.
 */
const MISSING_GLYPH_W = 6;
/** Height (in MC pixels) of the missing-glyph placeholder rect. */
const MISSING_GLYPH_H = 8;
/**
 * MC font ascent assumed for missing-glyph placement. The vanilla font
 * ascent is 7 — we use that as a sensible default so the placeholder sits
 * roughly on the baseline.
 */
const MISSING_GLYPH_ASCENT = 7;
/**
 * Inter-glyph kerning in MC pixels. Vanilla MC inserts 1 px of space
 * between adjacent bitmap glyphs; we mirror that so the rendered text
 * matches what the plugin will produce at runtime.
 */
const MC_KERNING = 1;

interface McFontTextProps {
  /** The literal string to render. Iterated with `[...]` for proper surrogate handling. */
  text: string;
  /** Font asset (type=font). Glyph PNGs are fetched per character via {@link fontGlyphUrl}. */
  font: Asset;
  /** Group origin x in stage pixels. */
  x: number;
  /** Group origin y in stage pixels (baseline of the text). */
  y: number;
  /** Pixel scale (e.g. 2 for the title canvas). Multiplies every glyph dimension. */
  scale: number;
  /**
   * Optional tint colour. Tinting bitmap glyphs requires either an offscreen
   * canvas composite or a Konva filter — not implemented yet. Accepted for API
   * parity; currently ignored.
   */
  color?: string;
  /**
   * Whether the group is interactive. Defaults to `false` so a McFontText
   * inside a draggable parent doesn't intercept events meant for that parent.
   */
  listening?: boolean;
}

/**
 * Renders one Konva Image per character of `text`, sourcing each glyph from
 * the supplied font asset's `glyphMap`. Mirrors how the Minecraft chat
 * pipeline lays out bitmap-font glyphs:
 *  - the x cursor advances by `glyph.width * scale + scale` per char
 *    (`+scale` is the 1 px MC kerning, scaled)
 *  - the glyph's top-left sits at `baselineY - ascent * scale`
 *
 * Missing glyphs (char not in `glyphMap`) render as a 6×8 yellow-tinted
 * placeholder rect so authors notice the gap.
 *
 * The Group is positioned at `(x, y)` in stage coords; internally we work
 * from `baselineY = 0` (i.e. `y` is the text baseline).
 */
export function McFontText({
  text,
  font,
  x,
  y,
  scale,
  color: _color,
  listening = false,
}: McFontTextProps) {
  // `y` is the baseline of the text; internally everything is measured
  // relative to the Group's origin, so baselineY = 0.
  const baselineY = 0;

  const chars = [...text]; // surrogate-pair-aware split
  const nodes: React.ReactNode[] = [];
  let cursorX = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const entry = font.fontMeta?.glyphMap.find((g) => g.char === ch);
    if (!entry) {
      // Missing glyph → yellow-tinted placeholder so the author sees the gap.
      const w = MISSING_GLYPH_W * scale;
      const h = MISSING_GLYPH_H * scale;
      const drawY = baselineY - MISSING_GLYPH_ASCENT * scale;
      nodes.push(
        <Rect
          key={`miss-${i}`}
          x={cursorX}
          y={drawY}
          width={w}
          height={h}
          fill="rgba(245,158,11,0.3)"
          stroke="#f59e0b"
          strokeWidth={1}
          listening={false}
        />,
      );
      cursorX += w + MC_KERNING * scale;
      continue;
    }
    nodes.push(
      <McFontGlyph
        key={`g-${i}`}
        font={font}
        char={ch}
        width={entry.width}
        height={entry.height}
        ascent={entry.ascent}
        x={cursorX}
        scale={scale}
        baselineY={baselineY}
      />,
    );
    cursorX += entry.width * scale + MC_KERNING * scale;
  }

  return (
    <Group x={x} y={y} listening={listening}>
      {nodes}
    </Group>
  );
}

interface GlyphProps {
  font: Asset;
  char: string;
  width: number;
  height: number;
  ascent: number;
  x: number;
  scale: number;
  baselineY: number;
}

/**
 * Single-glyph renderer. Extracted into its own component because `useImage`
 * is a hook and must run at the top of a render — we can't conditionally
 * call it inside the `McFontText` loop. Each glyph fetches its PNG via
 * {@link fontGlyphUrl}; while loading, we show a neutral grey placeholder.
 *
 * Y placement: in Minecraft, `ascent` is how many pixels the top of the
 * glyph sits above the baseline. Our `baselineY` is the y of the baseline
 * (relative to the parent Group), so the top-left draw point is
 * `baselineY - ascent * scale`.
 */
function McFontGlyph({ font, char, width, height, ascent, x, scale, baselineY }: GlyphProps) {
  const url = fontGlyphUrl(font, char);
  const [image] = useAuthenticatedImage(url ?? "");
  if (!url) return null;
  const w = width * scale;
  const h = height * scale;
  const drawY = baselineY - ascent * scale;
  return image ? (
    <KonvaImage image={image} x={x} y={drawY} width={w} height={h} listening={false} />
  ) : (
    <Rect x={x} y={drawY} width={w} height={h} fill="rgba(120,120,120,0.4)" listening={false} />
  );
}
