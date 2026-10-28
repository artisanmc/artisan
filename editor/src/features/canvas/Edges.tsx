import { docKey, documentKeys, findDocumentByKey, menusOf, parseDocKey } from "@/domain/documents";
import type { EdgeAnchor, Project } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useEffect, useMemo, useState } from "react";
import { Arrow, Circle } from "react-konva";
import { type Edge, deriveEdges } from "./deriveEdges";
import { type Box, anchorPoint, closestAnchorOnBox, routeEdges } from "./edgeRouting";
import { groupEdges } from "./groupedBoard";
import { nodeBox } from "./menuLayout";
import { findPreviewCallContexts } from "./previewCallContexts";
import { nextCallContext } from "./previewCallNavigation";
import { subCommandAnchors } from "./subCommandAnchors";

/** Keeps only the edges whose two ends are on the board. */
export function visibleEdges(
  edges: Edge[],
  layout: Record<string, { x: number; y: number }>,
): Edge[] {
  return edges.filter((e) => layout[e.source] && layout[e.target]);
}

interface EdgesProps {
  project: Project;
  layout: Record<string, { x: number; y: number }>;
  representatives?: Record<string, string>;
}

/** The keys of the Documents a selection touches: a Document itself, or the menu of a selected element. */
function deriveHighlightSet(
  project: Project,
  ids: ReadonlySet<string>,
  scope: string | null,
): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (scope === null && findDocumentByKey(project, id)) {
      out.add(id);
      continue;
    }
    // A module Document's part is scoped by its Document's key.
    if (scope !== null && findDocumentByKey(project, scope)) {
      out.add(scope);
      continue;
    }
    for (const m of menusOf(project)) {
      if (scope !== null && m.id !== scope) continue;
      if (m.layers.some((l) => l.elements.some((el) => el.id === id))) {
        out.add(docKey("menu", m.id));
        break;
      }
    }
  }
  return out;
}

export function Edges({ project, layout, representatives }: EdgesProps) {
  const selectedIds = useSelectionStore((s) => s.ids);
  const selectionScope = useSelectionStore((s) => s.menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const setMenuPreviewArgs = useUiStore((s) => s.setMenuPreviewArgs);
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);

  /**
   * Clicking a link to a parameterised menu does what a player would do: enter
   * it through that call. Clicking again advances one context — category to
   * category navigation, without going through a panel.
   * Cf. ADR `parameterised-menu-over-menu-per-category`.
   */
  const enterEdge = (edge: Edge) => {
    const target = menusOf(project).find((m) => docKey("menu", m.id) === edge.target);
    if (!target || (target.contextInputs ?? []).length === 0) return;
    const contexts = findPreviewCallContexts(target, project, snapshots, activeLang);
    const from = parseDocKey(edge.source)?.id;
    const next = nextCallContext(contexts, menuPreviewArgs[target.id], from);
    if (!next) return;
    setMenuPreviewArgs(target.id, next.args);
  };

  const highlightSet = useMemo(
    () =>
      new Set(
        [...deriveHighlightSet(project, selectedIds, selectionScope)].map(
          (id) => representatives?.[id] ?? id,
        ),
      ),
    [project, selectedIds, selectionScope, representatives],
  );
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
    for (const id of documentKeys(project)) {
      const box = nodeBox(project, id, layout);
      if (box) out[id] = box;
    }
    return out;
  }, [project, layout]);

  // Live preview while a handle is dragged — committed to the store on drag end.
  const [dragOverride, setDragOverride] = useState<{
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  } | null>(null);

  const edges = useMemo(
    () => visibleEdges(groupEdges(deriveEdges(project), representatives ?? {}), boxes),
    [project, boxes, representatives],
  );

  const overrides = useMemo(() => {
    // A sub-command's link leaves from its row, unless the user pinned that end.
    const rowAnchors = subCommandAnchors(project, edges, boxes);
    const pinned = project.canvasEdges ?? {};
    const base: typeof pinned = { ...pinned };
    for (const [id, { from }] of Object.entries(rowAnchors)) {
      base[id] = { ...pinned[id], from: pinned[id]?.from ?? from };
    }
    if (!dragOverride) return base;
    return {
      ...base,
      [dragOverride.edgeId]: {
        ...base[dragOverride.edgeId],
        [dragOverride.end]: dragOverride.anchor,
      },
    };
  }, [project, edges, boxes, dragOverride]);

  const routed = useMemo(() => routeEdges({ edges, boxes, overrides }), [edges, boxes, overrides]);

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
              enterEdge(e);
            }}
            onTap={(ev: Konva.KonvaEventObject<Event>) => {
              ev.cancelBubble = true;
              selectEdge(e.id);
              enterEdge(e);
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
            useProjectsStore
              .getState()
              .clearEdgeAnchor({ projectId: project.id, edgeId: edge.id, end });
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
                  useProjectsStore.getState().setEdgeAnchor({
                    projectId: project.id,
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
