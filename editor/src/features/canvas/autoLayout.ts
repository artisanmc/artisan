import { folderGroups } from "@/domain/canvasGroups";
import type { Project } from "@/domain/types";
import type { ArrangeMode } from "./arrangeBoard";
import { type BoardGroup, arrangeProjectGroups } from "./groupedBoard";
import { boardGraph, deriveServerGraph } from "./serverGraph";

type Point = { x: number; y: number };

/** Keyed by `docKey`: an id is unique within its kind only. */
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
  const graph = boardGraph(deriveServerGraph([project]));
  const pinned: Record<string, Point> = {};
  const layout = project.canvasLayout as Record<string, Point>;
  for (const node of graph.nodes) {
    const p = layout[node.docKey];
    if (p) pinned[node.key] = p;
  }
  const signature = JSON.stringify([
    graph.nodes.map((n) => [n.key, n.kind, n.width, n.height]),
    graph.edges.map((e) => e.id),
    pinned,
    folderGroups(project),
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
      members: g.members.map((key) => graph.nodes.find((n) => n.key === key)!.docKey),
    })),
    representatives: {},
  };
  for (const node of graph.nodes) {
    const p = arrangement.positions[node.key];
    if (p) board.layout[node.docKey] = p;
    board.allLayout[node.docKey] = arrangement.allPositions[node.key]!;
    const representative = arrangement.representatives[node.key]!;
    board.representatives[node.docKey] = representative === node.key ? node.docKey : representative;
  }
  if (bySignature.size > 64) bySignature.clear();
  bySignature.set(signature, board);
  return board;
}

export function autoLayout(project: Project): Record<string, Point> {
  return projectBoard(project).layout;
}

/** `Project.folders` with each folder frame pinned where `frames` put it. */
function withFramePositions(project: Project, frames: BoardGroup[]): Project["folders"] {
  const folders = { ...project.folders };
  for (const frame of frames) {
    if (frame.kind !== "group") continue;
    folders[frame.id] = { ...folders[frame.id], position: { x: frame.x, y: frame.y } };
  }
  return folders;
}

/** Arrange one level while freezing the geometry of every other level. */
export function rearrangeProjectLayout(
  project: Project,
  groupId?: string,
  mode: ArrangeMode = "columns",
): Pick<Project, "canvasLayout" | "folders" | "canvasEdges"> | null {
  const groups = folderGroups(project);
  const target = groups.find((g) => g.id === groupId);
  if (groupId !== undefined && !target) return null;
  // Without a folder frame, `columns` releases the positions and lets the board
  // arrange itself (original behaviour). The other modes must instead compute
  // and persist their arrangement.
  if (!groups.length && mode === "columns")
    return {
      canvasLayout: {} as Project["canvasLayout"],
      folders: project.folders,
      canvasEdges: {},
    };

  const before = projectBoard(project);
  const members = new Set(target?.nodeIds ?? []);
  const snapshot = {
    ...project,
    canvasLayout: Object.fromEntries(
      Object.entries(before.allLayout).filter(([id]) => !members.has(id)),
    ) as Project["canvasLayout"],
    folders: withFramePositions(project, before.groups),
  };
  const graph = boardGraph(deriveServerGraph([snapshot]));
  const arranged = arrangeProjectGroups(snapshot, graph, {
    releaseOuterPositions: groupId === undefined,
    mode,
  });
  const canvasLayout = Object.fromEntries(
    graph.nodes.map((node) => [node.docKey, arranged.positions[node.key]!]),
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
    folders: withFramePositions(project, arranged.groups),
  };
}
