import { folderGroups } from "@/domain/canvasGroups";
import type { EdgeAnchor, ProjectId } from "@/domain/types";
import type { ArrangeMode } from "@/features/canvas/arrangeBoard";
import { projectBoard, rearrangeProjectLayout } from "@/features/canvas/autoLayout";
import type { ProjectsSliceContext } from "./types";

/** The canvas: node positions, folder frames and edge anchors. */
export interface CanvasSlice {
  setCanvasPosition: (input: {
    projectId: ProjectId;
    nodeId: string;
    x: number;
    y: number;
  }) => void;
  /** Rearranges the board while keeping the groups' inner layout. */
  releaseBoardPositions: (input: { projectId: ProjectId; mode?: ArrangeMode }) => void;
  /** Rearranges inside one folder frame (`groupId`: the top-level folder). */
  rearrangeCanvasGroup: (input: { projectId: ProjectId; groupId: string }) => void;
  /** Drags a folder frame (`groupId`), or the whole board (`null`). */
  moveCanvasGroup: (input: {
    projectId: ProjectId;
    groupId: string | null;
    dx: number;
    dy: number;
  }) => void;
  /** Override one endpoint of a canvas edge ("source->target" id). */
  setEdgeAnchor: (input: {
    projectId: ProjectId;
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  }) => void;
  /** Remove an endpoint override; drops the entry when both ends are auto again. */
  clearEdgeAnchor: (input: { projectId: ProjectId; edgeId: string; end: "from" | "to" }) => void;
}

/** The board's layout is not Project content: these edits never stamp `updatedAt`. */
const LAYOUT = { touch: false } as const;

export const createCanvasSlice = ({ get, mutateProject }: ProjectsSliceContext): CanvasSlice => ({
  setCanvasPosition: ({ projectId: pId, nodeId, x, y }) => {
    const current = get().openProjects.projects.find((p) => p.id === pId);
    const group = current
      ? folderGroups(current).find((g) => g.nodeIds.includes(nodeId))
      : undefined;
    const layout = group && current ? projectBoard(current).allLayout : {};
    mutateProject(
      pId,
      (project) => {
        for (const id of group?.nodeIds ?? []) {
          if (layout[id])
            (project.canvasLayout as Record<string, { x: number; y: number }>)[id] = layout[id]!;
        }
        (project.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
      },
      LAYOUT,
    );
  },
  moveCanvasGroup: ({ projectId: pId, groupId, dx, dy }) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;
    const current = get().openProjects.projects.find((p) => p.id === pId);
    if (!current) return;
    const board = projectBoard(current);
    const frame = board.groups.find((g) =>
      groupId === null ? g.kind === "project" : g.kind === "group" && g.id === groupId,
    );
    if (!frame) return;
    mutateProject(
      pId,
      (project) => {
        const layout = project.canvasLayout as Record<string, { x: number; y: number }>;
        for (const id of frame.members) {
          const p = board.allLayout[id];
          if (p) layout[id] = { x: p.x + dx, y: p.y + dy };
        }
        for (const g of board.groups) {
          if (g.kind !== "group" || (groupId !== null && g.id !== groupId)) continue;
          project.folders = {
            ...project.folders,
            [g.id]: { ...project.folders?.[g.id], position: { x: g.x + dx, y: g.y + dy } },
          };
        }
      },
      LAYOUT,
    );
  },
  releaseBoardPositions: ({ projectId: pId, mode }) => {
    const current = get().openProjects.projects.find((p) => p.id === pId);
    if (!current) return;
    const layout = rearrangeProjectLayout(current, undefined, mode);
    if (!layout) return;
    mutateProject(
      pId,
      (project) => {
        Object.assign(project, layout);
      },
      LAYOUT,
    );
  },
  rearrangeCanvasGroup: ({ projectId: pId, groupId }) => {
    const current = get().openProjects.projects.find((p) => p.id === pId);
    if (!current) return;
    const layout = rearrangeProjectLayout(current, groupId);
    if (!layout) return;
    mutateProject(
      pId,
      (project) => {
        Object.assign(project, layout);
      },
      LAYOUT,
    );
  },
  setEdgeAnchor: ({ projectId: pId, edgeId, end, anchor }) =>
    mutateProject(
      pId,
      (project) => {
        project.canvasEdges ??= {};
        project.canvasEdges[edgeId] = { ...project.canvasEdges[edgeId], [end]: anchor };
      },
      LAYOUT,
    ),
  clearEdgeAnchor: ({ projectId: pId, edgeId, end }) =>
    mutateProject(
      pId,
      (project) => {
        const entry = project.canvasEdges?.[edgeId];
        if (!entry) return;
        delete entry[end];
        if (!entry.from && !entry.to) delete project.canvasEdges![edgeId];
      },
      LAYOUT,
    ),
});
