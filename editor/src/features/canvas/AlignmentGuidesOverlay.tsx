import { useCssVar } from "@/lib/themeColors";
import { useAlignmentStore } from "@/state/alignmentStore";
import { Line } from "react-konva";

// Note: file named *Overlay to avoid a case-insensitive-filesystem (Windows)
// clash with the pure `alignmentGuides.ts` module in this directory — importing
// "./AlignmentGuides" would resolve to that file and yield an undefined export.
export function AlignmentGuides() {
  const guides = useAlignmentStore((s) => s.guides);
  const brand = useCssVar("--brand");
  return (
    <>
      {guides.map((g, i) => (
        <Line
          key={`${g.axis}-${g.pos}-${i}`}
          points={g.axis === "x" ? [g.pos, g.from, g.pos, g.to] : [g.from, g.pos, g.to, g.pos]}
          stroke={brand}
          strokeWidth={1}
          dash={[4, 4]}
          listening={false}
        />
      ))}
    </>
  );
}
