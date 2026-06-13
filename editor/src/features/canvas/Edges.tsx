import type { EdgeAnchor, Pack } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useEffect, useMemo, useState } from "react";
import { Arrow, Circle } from "react-konva";
import { deriveEdges, type Edge } from "./deriveEdges";
import { anchorPoint, closestAnchorOnBox, routeEdges, type Box } from "./edgeRouting";
import { nodeBox } from "./menuLayout";

/** Ne garde que les edges dont les deux extrémités sont sur la planche. */
export function visibleEdges(edges: Edge[], layout: Record<string, { x: number; y: number }>): Edge[] {
  return edges.filter((e) => layout[e.source] && layout[e.target]);
}

interface EdgesProps {
  pack: Pack;
  layout: Record<string, { x: number; y: number }>;
}

function deriveHighlightSet(pack: Pack, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (
      pack.menus.some((m) => m.id === id) ||
      pack.commands.some((c) => c.id === id) ||
      (pack.dialogs ?? []).some((d) => d.id === id)
    ) {
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
  const selectedIds = useSelectionStore((s) => s.ids);
  const highlightSet = useMemo(() => deriveHighlightSet(pack, selectedIds), [pack, selectedIds]);
  const hoveredEdgeId = useEdgeHoverStore((s) => s.edge?.id ?? null);
  const setHover = useEdgeHoverStore((s) => s.set);
  const moveHover = useEdgeHoverStore((s) => s.move);
  const selectedEdgeId = useEdgeSelectionStore((s) => s.edgeId);
  const brand = useCssVar("--brand");
  const edgeIdle = useCssVar("--border");

  // Selecting a node dismisses the edge selection (and its handles).
  useEffect(() => {
    if (selectedIds.size > 0) useEdgeSelectionStore.getState().select(null);
  }, [selectedIds]);

  const boxes = useMemo(() => {
    const out: Record<string, Box> = {};
    for (const m of pack.menus) {
      const box = nodeBox(pack, m.id, layout);
      if (box) out[m.id] = box;
    }
    for (const c of pack.commands) {
      const box = nodeBox(pack, c.id, layout);
      if (box) out[c.id] = box;
    }
    for (const d of pack.dialogs ?? []) {
      const box = nodeBox(pack, d.id, layout);
      if (box) out[d.id] = box;
    }
    return out;
  }, [pack, layout]);

  // Live preview while a handle is dragged — committed to the store on drag end.
  const [dragOverride, setDragOverride] = useState<{
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  } | null>(null);

  const overrides = useMemo(() => {
    const base = pack.canvasEdges ?? {};
    if (!dragOverride) return base;
    return {
      ...base,
      [dragOverride.edgeId]: {
        ...base[dragOverride.edgeId],
        [dragOverride.end]: dragOverride.anchor,
      },
    };
  }, [pack.canvasEdges, dragOverride]);

  const routed = useMemo(
    () => routeEdges({ edges: visibleEdges(deriveEdges(pack), layout), boxes, overrides }),
    [pack, layout, boxes, overrides],
  );

  const selectEdge = (id: string) => {
    useEdgeSelectionStore.getState().select(id);
    useSelectionStore.getState().clear();
  };

  const selectedRouted = routed.find((r) => r.edge.id === selectedEdgeId) ?? null;

  return (
    <>
      {routed.map((r) => {
        const e = r.edge;
        const isHovered = hoveredEdgeId === e.id;
        const isSelected = selectedEdgeId === e.id;
        const highlighted =
          isHovered || isSelected || highlightSet.has(e.source) || highlightSet.has(e.target);
        const color = highlighted ? brand : edgeIdle;
        return (
          <Arrow
            key={e.id}
            points={r.points}
            bezier
            stroke={color}
            fill={color}
            strokeWidth={highlighted ? 2.5 : 1.5}
            pointerLength={9}
            pointerWidth={8}
            hitStrokeWidth={12}
            onClick={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              ev.cancelBubble = true;
              selectEdge(e.id);
            }}
            onTap={(ev: Konva.KonvaEventObject<Event>) => {
              ev.cancelBubble = true;
              selectEdge(e.id);
            }}
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
      {selectedRouted &&
        (["from", "to"] as const).map((end) => {
          const edge = selectedRouted.edge;
          const nodeId = end === "from" ? edge.source : edge.target;
          const box = boxes[nodeId];
          if (!box) return null;
          const pt = end === "from" ? selectedRouted.from : selectedRouted.to;
          const reset = () =>
            useAccountStore.getState().clearEdgeAnchor({ packId: pack.id, edgeId: edge.id, end });
          return (
            <Circle
              key={`${edge.id}:${end}`}
              x={pt.x}
              y={pt.y}
              radius={6}
              fill={brand}
              stroke="#ffffff"
              strokeWidth={1.5}
              draggable
              onDragMove={(ev: Konva.KonvaEventObject<DragEvent>) => {
                const anchor = closestAnchorOnBox(box, ev.target.position());
                ev.target.position(anchorPoint(box, anchor)); // snap to the border
                setDragOverride({ edgeId: edge.id, end, anchor });
              }}
              onDragEnd={() => {
                if (dragOverride) {
                  useAccountStore.getState().setEdgeAnchor({
                    packId: pack.id,
                    edgeId: dragOverride.edgeId,
                    end: dragOverride.end,
                    anchor: dragOverride.anchor,
                  });
                }
                setDragOverride(null);
              }}
              onDblClick={reset}
              onDblTap={reset}
            />
          );
        })}
    </>
  );
}
