import { parseMiniMessage } from "@/lib/miniMessage";
import { Group, Text } from "react-konva";

interface MiniMessageKonvaTextProps {
  source: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily?: string;
  /** Fallback color when no <color> is active (vanilla MC default is white;
   *  for our editor's light gray title bar we pass #404040). */
  defaultColor?: string;
  listening?: boolean;
  /** Per-char advance; defaults to the MC font ratio (fontSize × 0.75). */
  charWidth?: number;
}

/**
 * Konva renderer: parse MiniMessage and emit a row of <Text> nodes inside a
 * <Group>, each with the segment's style applied. Width is approximated from
 * the monospace assumption (charWidth ≈ fontSize × 0.6) — good enough for
 * single-line title bars and labels.
 */
export function MiniMessageKonvaText({
  source,
  x,
  y,
  fontSize,
  fontFamily = "ui-monospace, monospace",
  defaultColor = "#404040",
  listening = false,
  // MC default font: ~6px advance per 8px-tall glyph → 0.75 ratio.
  charWidth = fontSize * 0.75,
}: MiniMessageKonvaTextProps) {
  const segments = parseMiniMessage(source);
  let cursor = 0;

  return (
    <Group x={x} y={y} listening={listening}>
      {segments.map((seg, i) => {
        const width = seg.text.length * charWidth;
        const fill = seg.style.color ?? defaultColor;
        const fontStyle =
          seg.style.bold && seg.style.italic
            ? "bold italic"
            : seg.style.bold
              ? "bold"
              : seg.style.italic
                ? "italic"
                : "normal";
        const decorationParts: string[] = [];
        if (seg.style.underlined) decorationParts.push("underline");
        if (seg.style.strikethrough) decorationParts.push("line-through");
        const node = (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are stable for a given source
            key={i}
            x={cursor}
            y={0}
            text={seg.text}
            fontFamily={fontFamily}
            fontSize={fontSize}
            fontStyle={fontStyle}
            fill={fill}
            textDecoration={decorationParts.join(" ") || undefined}
            listening={false}
          />
        );
        cursor += width;
        return node;
      })}
    </Group>
  );
}
