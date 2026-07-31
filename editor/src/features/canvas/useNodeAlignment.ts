import { useCallback } from "react";
import type Konva from "konva";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAlignmentStore } from "@/state/alignmentStore";
import { alignmentGuides, type Box } from "./alignmentGuides";
import { nodeBox } from "./menuLayout";

const THRESHOLD = 8;

export function computeAndApplyAlignment(
  projectId: ProjectId,
  selfId: string,
  node: { x: (v?: number) => number; y: (v?: number) => number },
  altKey: boolean,
): void {
  const align = useAlignmentStore.getState();
  if (altKey) {
    align.clear();
    return;
  }
  const project = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
  if (!project) return;
  const layout = project.canvasLayout as Record<string, { x: number; y: number }>;
  const selfBox = nodeBox(project, selfId, layout);
  if (!selfBox) return;
  const dragged: Box = { x: node.x(), y: node.y(), width: selfBox.width, height: selfBox.height };
  const others: Box[] = [];
  for (const id of Object.keys(layout)) {
    if (id === selfId) continue;
    const b = nodeBox(project, id, layout);
    if (b) others.push(b);
  }
  const res = alignmentGuides(dragged, others, THRESHOLD);
  if (res.snapX !== undefined) node.x(res.snapX);
  if (res.snapY !== undefined) node.y(res.snapY);
  align.setGuides(res.guides);
}

export function useNodeAlignment(projectId: ProjectId, selfId: string) {
  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // Konva bubbles drag events from child shapes (e.g. menu slots) up to the
      // parent group. Only compute alignment when THIS node is the drag target —
      // otherwise a slot drag would teleport the slot + draw stray guides.
      if ((e.target as Konva.Node).id?.() !== selfId) return;
      const alt = (e.evt as unknown as { altKey?: boolean }).altKey ?? false;
      computeAndApplyAlignment(
        projectId,
        selfId,
        e.target as unknown as { x: (v?: number) => number; y: (v?: number) => number },
        alt,
      );
    },
    [projectId, selfId],
  );
  return { onDragMove };
}
