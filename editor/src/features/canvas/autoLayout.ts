import { liveDocumentIds, normalizeCanvasGroups } from "@/domain/canvasGroups";
import type { Project } from "@/domain/types";
import type { ArrangeMode } from "./arrangeBoard";
import { type BoardGroup, arrangeProjectGroups } from "./groupedBoard";
import { deriveServerGraph } from "./serverGraph";

type Point = { x: number; y: number };

export interface ProjectBoard {
  layout: Record<string, Point>;
  gutter: Point | null;
  groups: BoardGroup[];
  allLayout: Record<string, Point>;
  representatives: Record<string, string>;
}

const bySignature = new Map<string, ProjectBoard>();

/**
 * A project's board: all its Documents, arranged automatically.
 * `canvasLayout` only keeps the positions set by hand, which take precedence
 * over the arrangement.
 *
 * Memoised on the graph's shape: editing a slot or a text recomputes nothing,
 * only an added, removed or resized Document or link does.
 */
export function projectBoard(project: Project): ProjectBoard {
  const graph = deriveServerGraph([project]);
  const pinned: Record<string, Point> = {};
  const layout = project.canvasLayout as Record<string, Point>;
  for (const node of graph.nodes) {
    const p = layout[node.docId];
    if (p) pinned[node.key] = p;
  }
  const signature = JSON.stringify([
    graph.nodes.map((n) => [n.key, n.kind, n.width, n.height]),
    graph.edges.map((e) => e.id),
    pinned,
    project.canvasGroups,
    project.name,
  ]);
  const cached = bySignature.get(signature);
  if (cached) return cached;

  const arrangement = arrangeProjectGroups(project, graph);
  const board: ProjectBoard = {
    layout: {},
    allLayout: {},
    gutter: arrangement.gutter,
    groups: arrangement.groups.map((g) => ({
      ...g,
      members: g.members.map((key) => graph.nodes.find((n) => n.key === key)!.docId),
    })),
    representatives: {},
  };
  for (const node of graph.nodes) {
    const p = arrangement.positions[node.key];
    if (p) board.layout[node.docId] = p;
    board.allLayout[node.docId] = arrangement.allPositions[node.key]!;
    const representative = arrangement.representatives[node.key]!;
    board.representatives[node.docId] = representative === node.key ? node.docId : representative;
  }
  if (bySignature.size > 64) bySignature.clear();
  bySignature.set(signature, board);
  return board;
}

export function autoLayout(project: Project): Record<string, Point> {
  return projectBoard(project).layout;
}

/** Arrange one level while freezing the geometry of every other level. */
export function rearrangeProjectLayout(
  project: Project,
  groupId?: string,
  mode: ArrangeMode = "columns",
): Pick<Project, "canvasLayout" | "canvasGroups" | "canvasEdges"> | null {
  const groups = normalizeCanvasGroups(project.canvasGroups, liveDocumentIds(project));
  const target = groups.find((g) => g.id === groupId);
  if (groupId !== undefined && !target) return null;
  // Without a manual group, `columns` releases the positions and lets the board
  // arrange itself (original behaviour). The other modes must instead compute
  // and persist their arrangement.
  if (!groups.length && mode === "columns")
    return { canvasLayout: {} as Project["canvasLayout"], canvasGroups: groups, canvasEdges: {} };

  const before = projectBoard(project);
  const members = new Set(target?.nodeIds ?? []);
  const snapshot = {
    ...project,
    canvasLayout: Object.fromEntries(
      Object.entries(before.allLayout).filter(([id]) => !members.has(id)),
    ) as Project["canvasLayout"],
    canvasGroups: groups.map((group) => {
      const frame = before.groups.find((g) => g.kind === "group" && g.id === group.id)!;
      return { ...group, position: { x: frame.x, y: frame.y } };
    }),
  };
  const graph = deriveServerGraph([snapshot]);
  const arranged = arrangeProjectGroups(snapshot, graph, {
    releaseOuterPositions: groupId === undefined,
    mode,
  });
  const canvasLayout = Object.fromEntries(
    graph.nodes.map((node) => [node.docId, arranged.positions[node.key]!]),
  ) as Project["canvasLayout"];
  const membership = new Map(groups.flatMap((g) => g.nodeIds.map((id) => [id, g.id] as const)));
  const canvasEdges = Object.fromEntries(
    Object.entries(project.canvasEdges ?? {}).filter(([id]) => {
      const [source, destination] = id.split("->");
      const owner = membership.get(source!);
      const internal = owner !== undefined && owner === membership.get(destination!);
      return groupId === undefined ? internal : !(internal && owner === groupId);
    }),
  );
  return {
    canvasLayout,
    canvasEdges,
    canvasGroups: groups.map((group) => {
      const frame = arranged.groups.find((g) => g.kind === "group" && g.id === group.id)!;
      return { ...group, position: { x: frame.x, y: frame.y } };
    }),
  };
}
