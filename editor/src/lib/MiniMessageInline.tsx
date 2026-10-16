import { type CSSProperties, Fragment } from "react";
import { type Style, parseMiniMessage } from "./miniMessage";

const fontFamilyFor = (font: string | undefined): string | undefined => {
  if (!font) return undefined;
  const key = font.replace(/^minecraft:/, "");
  switch (key) {
    case "default":
      return undefined;
    case "uniform":
      return '"GNU Unifont", "DejaVu Sans Mono", monospace';
    case "alt":
    case "illageralt":
      return "fantasy, cursive";
    default:
      return "fantasy, cursive";
  }
};

const styleToCss = (s: Style): CSSProperties => {
  const decorationParts: string[] = [];
  if (s.underlined || s.interactive) decorationParts.push("underline");
  if (s.strikethrough) decorationParts.push("line-through");
  return {
    color: s.color,
    fontWeight: s.bold === true ? 600 : s.bold === false ? 400 : undefined,
    fontStyle: s.italic === true ? "italic" : s.italic === false ? "normal" : undefined,
    textDecoration: decorationParts.join(" ") || undefined,
    textDecorationStyle: s.interactive ? "dotted" : undefined,
    textShadow: s.shadow ? `0 0 0.15em ${hexWithAlpha(s.shadow.color, s.shadow.alpha)}` : undefined,
    fontFamily: fontFamilyFor(s.font),
    cursor: s.interactive ? "pointer" : undefined,
  };
};

const hexWithAlpha = (hex: string, alpha: number): string => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
};

interface MiniMessageInlineProps {
  source: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * DOM renderer: emit styled <span>s for each parsed segment. Use anywhere
 * MiniMessage text appears as HTML — properties pane previews, tooltips,
 * sidebar labels, etc. For Konva canvas text, use VanillaMcText (vanilla MC font) or McFontText (a font asset).
 *
 * Pass `style` (or class-based color/italic) on the wrapper to set defaults
 * — MM tags inside the source override on a per-segment basis (the segment
 * span's color wins over the wrapper's color via cascade).
 */
export function MiniMessageInline({ source, className, style }: MiniMessageInlineProps) {
  const segments = parseMiniMessage(source);
  return (
    <span className={className} style={style}>
      {segments.map((seg, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are stable for a given source
        <Fragment key={i}>
          <span style={styleToCss(seg.style)}>{seg.text}</span>
        </Fragment>
      ))}
    </span>
  );
}
