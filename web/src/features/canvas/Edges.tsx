import type { Pack } from "@/domain/types";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useMemo } from "react";
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

function deriveHighlightSet(pack: Pack, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (pack.menus.some((m) => m.id === id) || pack.commands.some((c) => c.id === id)) {
      out.add(id);
      continue;
    }
    for (const m of pack.menus) {
      if (m.layers.some((l) => l.elements.some((el) => el.id === id))) {
        out.add(m.id);
        break;
      }
    }
  }
  return out;
}

export function Edges({ pack, layout }: EdgesProps) {
  const edges = deriveEdges(pack);
  const selectedIds = useSelectionStore((s) => s.ids);
  const highlightSet = useMemo(() => deriveHighlightSet(pack, selectedIds), [pack, selectedIds]);
  const hoveredEdgeId = useEdgeHoverStore((s) => s.edge?.id ?? null);
  const setHover = useEdgeHoverStore((s) => s.set);
  const moveHover = useEdgeHoverStore((s) => s.move);

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
        const isHovered = hoveredEdgeId === e.id;
        const highlighted = isHovered || highlightSet.has(e.source) || highlightSet.has(e.target);
        return (
          <Line
            key={e.id}
            points={[sx, sy, midX, sy, midX, ty, tx, ty]}
            stroke={highlighted ? "#22c55e" : "#52525b"}
            strokeWidth={highlighted ? 2.5 : 1.5}
            bezier
            tension={0.3}
            hitStrokeWidth={12}
            onMouseEnter={(ev: Konva.KonvaEventObject<MouseEvent>) =>
              setHover(e, ev.evt.clientX, ev.evt.clientY)
            }
            onMouseMove={(ev: Konva.KonvaEventObject<MouseEvent>) =>
              moveHover(ev.evt.clientX, ev.evt.clientY)
            }
            onMouseLeave={() => setHover(null)}
          />
        );
      })}
    </>
  );
}
