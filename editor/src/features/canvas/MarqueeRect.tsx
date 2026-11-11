import { useCssVar } from "@/lib/themeColors";
import { Rect } from "react-konva";
import type { MarqueeRectState } from "./useMarqueeSelection";

export function MarqueeRect({ rect }: { rect: MarqueeRectState | null }) {
  const brand = useCssVar("--brand");
  if (!rect) return null;
  return (
    <Rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill={brand}
      opacity={0.12}
      stroke={brand}
      strokeWidth={1}
      listening={false}
    />
  );
}
