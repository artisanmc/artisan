import type { Pack } from "@/domain/types";
import { Line } from "react-konva";
import { deriveEdges } from "./deriveEdges";
import { COMMAND_BOX, menuBoxSize } from "./menuLayout";

interface EdgesProps {
  pack: Pack;
  layout: Record<string, { x: number; y: number }>;
}

function boxFor(pack: Pack, id: string) {
  const menu = pack.menus.find((m) => m.id === id);
  if (menu) return menuBoxSize(menu.rows);
  return COMMAND_BOX;
}

export function Edges({ pack, layout }: EdgesProps) {
  const edges = deriveEdges(pack);
  return (
    <>
      {edges.map((e) => {
        const src = layout[e.source];
        const tgt = layout[e.target];
        if (!src || !tgt) return null;
        const srcBox = boxFor(pack, e.source);
        const tgtBox = boxFor(pack, e.target);
        const sx = src.x + srcBox.width;
        const sy = src.y + srcBox.height / 2;
        const tx = tgt.x;
        const ty = tgt.y + tgtBox.height / 2;
        const midX = (sx + tx) / 2;
        return (
          <Line
            key={e.id}
            points={[sx, sy, midX, sy, midX, ty, tx, ty]}
            stroke="#52525b"
            strokeWidth={1.5}
            bezier
            tension={0.3}
            listening={false}
          />
        );
      })}
    </>
  );
}
