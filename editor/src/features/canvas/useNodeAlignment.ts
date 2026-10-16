import type { ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import type Konva from "konva";
import { useCallback } from "react";
import { type Box, alignmentGuides } from "./alignmentGuides";
import { autoLayout } from "./autoLayout";
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
  const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
  if (!project) return;
  const layout = autoLayout(project);
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
