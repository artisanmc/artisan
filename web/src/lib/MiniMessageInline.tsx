import { type CSSProperties, Fragment } from "react";
import { type Style, parseMiniMessage } from "./miniMessage";

const styleToCss = (s: Style): CSSProperties => ({
  color: s.color,
  fontWeight: s.bold ? 600 : undefined,
  fontStyle: s.italic ? "italic" : undefined,
  textDecoration:
    s.underlined && s.strikethrough
      ? "underline line-through"
      : s.underlined
        ? "underline"
        : s.strikethrough
          ? "line-through"
          : undefined,
});

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
