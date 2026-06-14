import { useCallback } from "react";
import type Konva from "konva";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAlignmentStore } from "@/state/alignmentStore";
import { alignmentGuides, type Box } from "./alignmentGuides";
import { nodeBox } from "./menuLayout";

const THRESHOLD = 8;

export function computeAndApplyAlignment(
  packId: PackId,
  selfId: string,
  node: { x: (v?: number) => number; y: (v?: number) => number },
  altKey: boolean,
): void {
  const align = useAlignmentStore.getState();
  if (altKey) {
    align.clear();
    return;
  }
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId);
  if (!pack) return;
  const layout = pack.canvasLayout as Record<string, { x: number; y: number }>;
  const selfBox = nodeBox(pack, selfId, layout);
  if (!selfBox) return;
  const dragged: Box = { x: node.x(), y: node.y(), width: selfBox.width, height: selfBox.height };
  const others: Box[] = [];
  for (const id of Object.keys(layout)) {
    if (id === selfId) continue;
    const b = nodeBox(pack, id, layout);
    if (b) others.push(b);
  }
  const res = alignmentGuides(dragged, others, THRESHOLD);
  if (res.snapX !== undefined) node.x(res.snapX);
  if (res.snapY !== undefined) node.y(res.snapY);
  align.setGuides(res.guides);
}

export function useNodeAlignment(packId: PackId, selfId: string) {
  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const alt = (e.evt as unknown as { altKey?: boolean }).altKey ?? false;
      computeAndApplyAlignment(
        packId,
        selfId,
        e.target as unknown as { x: (v?: number) => number; y: (v?: number) => number },
        alt,
      );
    },
    [packId, selfId],
  );
  return { onDragMove };
}
