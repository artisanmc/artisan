import { type CSSProperties, Fragment } from "react";
import { type Style, parseMiniMessage } from "./miniMessage";

const styleToCss = (s: Style): CSSProperties => {
  const decorationParts: string[] = [];
  if (s.underlined) decorationParts.push("underline");
  if (s.strikethrough) decorationParts.push("line-through");
  return {
    color: s.color,
    fontWeight: s.bold === true ? 600 : s.bold === false ? 400 : undefined,
    fontStyle: s.italic === true ? "italic" : s.italic === false ? "normal" : undefined,
    textDecoration: decorationParts.join(" ") || undefined,
    textShadow: s.shadow ? `0 0 0.15em ${hexWithAlpha(s.shadow.color, s.shadow.alpha)}` : undefined,
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
}

/**
 * DOM renderer: emit styled <span>s for each parsed segment. Use anywhere
 * MiniMessage text appears as HTML — properties pane previews, tooltips,
 * sidebar labels, etc. For Konva canvas text, use MiniMessageKonvaText.
 */
export function MiniMessageInline({ source, className }: MiniMessageInlineProps) {
  const segments = parseMiniMessage(source);
  return (
    <span className={className}>
      {segments.map((seg, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are stable for a given source
        <Fragment key={i}>
          <span style={styleToCss(seg.style)}>{seg.text}</span>
        </Fragment>
      ))}
    </span>
  );
}
