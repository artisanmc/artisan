import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { API_URL } from "@/lib/api/client";
import { cn } from "@/lib/cx";
import {
  type Segment,
  type Style,
  parseMiniMessage,
  parseMiniMessageSource,
  plainTextFromMiniMessage,
} from "@/lib/miniMessage";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import useImage from "use-image";
import {
  LINE_BOX,
  type McAtlases,
  drawLine,
  hasObfuscated,
  lineWidth,
  splitLines,
} from "./mcGlyphs";

const ATLAS_VERSION = "1.21.4";
const atlasUrl = (name: string) => `${API_URL}/api/v1/textures/${ATLAS_VERSION}/font/${name}`;

/** The vanilla font atlases, or null while loading or when the hub cannot serve them. */
export function useMcAtlases(): McAtlases | null {
  const [ascii] = useImage(atlasUrl("ascii"), "anonymous");
  const [accented] = useImage(atlasUrl("accented"), "anonymous");
  const [nonlatin] = useImage(atlasUrl("nonlatin_european"), "anonymous");
  return useMemo(
    () => (ascii && accented && nonlatin ? { ascii, accented, nonlatin_european: nonlatin } : null),
    [ascii, accented, nonlatin],
  );
}

export interface McTextProps {
  /** MiniMessage; `\n` (or `<newline>`) starts a new line. */
  source: string;
  /** What the game applies without tags (a lore's purple, a MOTD's gray). */
  defaults?: Style;
  /** CSS pixels per MC pixel. */
  scale?: number;
  /** Line pitch in MC pixels (chat 9, tooltip 10). */
  lineHeight?: number;
  shadow?: boolean;
  /** Each line parsed alone, as a lore's entries are. */
  perLine?: boolean;
  /** Horizontal alignment of lines narrower than the widest one. */
  align?: "left" | "center";
  className?: string;
  style?: CSSProperties;
}

/**
 * MiniMessage as the client draws it: vanilla bitmap font, colors, decorations, shadow.
 * Falls back to styled HTML text while the font atlases are not available.
 */
export function McText({
  source,
  defaults = {},
  scale = 2,
  lineHeight = 10,
  shadow = true,
  perLine = false,
  align = "left",
  className,
  style,
}: McTextProps) {
  const atlases = useMcAtlases();
  const lines = useMemo(() => {
    const segs: Segment[] = perLine
      ? parseMiniMessageSource(source, true).map(({ text, style: s }) => ({ text, style: s }))
      : parseMiniMessage(source);
    return splitLines(segs);
  }, [source, perLine]);
  const label = useMemo(() => plainTextFromMiniMessage(source), [source]);
  const animated = hasObfuscated(lines, defaults);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animated) return;
    const timer = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(timer);
  }, [animated]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const widths = lines.map((l) => lineWidth(l, defaults));
  const maxWidth = Math.max(0, ...widths) + (shadow ? 1 : 0);
  const height = (lines.length - 1) * lineHeight + LINE_BOX + (shadow ? 1 : 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!atlases || !canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const px = scale * dpr;
    canvas.width = Math.max(1, Math.ceil(maxWidth * px));
    canvas.height = Math.max(1, Math.ceil(height * px));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const tintCanvas = document.createElement("canvas");
    tintCanvas.width = 16 * px;
    tintCanvas.height = 16 * px;
    const tint = tintCanvas.getContext("2d");
    if (!tint) return;
    tint.imageSmoothingEnabled = false;
    lines.forEach((line, k) => {
      const x = align === "center" ? ((maxWidth - (shadow ? 1 : 0) - widths[k]!) / 2) * px : 0;
      drawLine(
        ctx,
        atlases,
        line,
        Math.round(x),
        k * lineHeight * px,
        {
          defaults,
          scale: px,
          shadow,
          tick,
        },
        tint,
      );
    });
  }, [atlases, lines, widths, maxWidth, height, scale, lineHeight, shadow, defaults, tick, align]);

  if (!atlases) {
    return (
      <span
        className={cn(
          "inline-flex flex-col font-mono",
          align === "center" && "items-center",
          className,
        )}
        style={{
          color: defaults.color,
          fontStyle: defaults.italic ? "italic" : undefined,
          fontSize: 8 * scale,
          lineHeight: `${lineHeight * scale}px`,
          ...style,
        }}
        data-testid="mc-text-fallback"
      >
        {source.split(perLine ? "\n" : /\n|<newline>|<br\/?>/i).map((line, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
          <MiniMessageInline key={k} source={line || "​"} className="block whitespace-pre" />
        ))}
      </span>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={cn("block", className)}
      style={{
        width: maxWidth * scale,
        height: height * scale,
        imageRendering: "pixelated",
        ...style,
      }}
    />
  );
}
