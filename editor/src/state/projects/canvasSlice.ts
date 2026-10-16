import { isGroupColor, liveDocumentIds, normalizeCanvasGroups } from "@/domain/canvasGroups";
import type { EdgeAnchor, ProjectId } from "@/domain/types";
import type { ArrangeMode } from "@/features/canvas/arrangeBoard";
import { projectBoard, rearrangeProjectLayout } from "@/features/canvas/autoLayout";
import type { ProjectsSliceContext } from "./types";

/** The canvas: node positions, groups and edge anchors. */
export interface CanvasSlice {
  setCanvasPosition: (input: {
    projectId: ProjectId;
    nodeId: string;
    x: number;
    y: number;
  }) => void;
  /** Rearranges the board while keeping the groups' inner layout. */
  releaseBoardPositions: (input: { projectId: ProjectId; mode?: ArrangeMode }) => void;
  rearrangeCanvasGroup: (input: { projectId: ProjectId; groupId: string }) => void;
  createCanvasGroup: (input: {
    projectId: ProjectId;
    name: string;
    nodeIds: string[];
    color?: string;
  }) => string;
  updateCanvasGroup: (input: {
    projectId: ProjectId;
    groupId: string;
    name?: string;
    color?: string;
  }) => void;
  dissolveCanvasGroup: (input: { projectId: ProjectId; groupId: string }) => void;
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
    const group = current?.canvasGroups?.find((g) => g.nodeIds.includes(nodeId));
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
  createCanvasGroup: ({ projectId: pId, name, nodeIds, color }) => {
    const id = crypto.randomUUID();
    if (!get().openProjects.projects.some((p) => p.id === pId) || !name.trim())
      throw new Error("Invalid group");
    mutateProject(
      pId,
      (project) => {
        const members = [...new Set(nodeIds)];
        const live = new Set(liveDocumentIds(project));
        if (members.length < 2 || members.some((key) => !live.has(key)))
          throw new Error("Select at least two documents in this project");
        project.canvasGroups = normalizeCanvasGroups(
          [{ id, name: name.trim(), nodeIds: members, color }, ...(project.canvasGroups ?? [])],
          live,
        );
        for (const key of members) delete (project.canvasLayout as Record<string, unknown>)[key];
      },
      LAYOUT,
    );
    return id;
  },
  updateCanvasGroup: ({ projectId: pId, groupId, name, color }) =>
    mutateProject(
      pId,
      (project) => {
        const group = project.canvasGroups?.find((g) => g.id === groupId);
        if (!group) return;
        if (name?.trim()) group.name = name.trim();
        if (isGroupColor(color)) group.color = color;
      },
      LAYOUT,
    ),
  dissolveCanvasGroup: ({ projectId: pId, groupId }) =>
    mutateProject(
      pId,
      (project) => {
        project.canvasGroups = project.canvasGroups?.filter((g) => g.id !== groupId);
      },
      LAYOUT,
    ),
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
        for (const group of project.canvasGroups ?? []) {
          if (groupId !== null && group.id !== groupId) continue;
          const g = board.groups.find((f) => f.kind === "group" && f.id === group.id);
          if (g) group.position = { x: g.x + dx, y: g.y + dy };
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
