import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useEffect, useRef } from "react";
import { Transformer } from "react-konva";

interface SelectionProps {
  stageRef: React.RefObject<Konva.Stage | null>;
}

/**
 * Konva Transformer overlay attached to the currently-selected node(s).
 * v1 disables resize/rotate handles — Transformer is purely a visual
 * indicator (the green stroke on each Group is the primary cue, but this
 * adds a subtle outer bounding box for multi-select).
 */
export function Selection({ stageRef }: SelectionProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const ids = useSelectionStore((s) => s.ids);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids is the trigger; stageRef is stable
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes: Konva.Node[] = [];
    for (const id of ids) {
      const node = stage.findOne((n: Konva.Node) => n.id() === id);
      if (node) nodes.push(node);
    }
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [ids]);

  return (
    <Transformer
      ref={transformerRef}
      enabledAnchors={[]}
      rotateEnabled={false}
      borderStroke="#22c55e"
      borderStrokeWidth={1}
      borderDash={[4, 4]}
    />
  );
}
