import { normalizeCanvasGroups } from "@/domain/canvasGroups";
import type { Project } from "@/domain/types";
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
 * La planche d'un project : tous ses Documents, arrangés automatiquement.
 * `canvasLayout` ne liste plus les membres de la planche ; il ne garde que
 * les positions posées à la main, qui priment sur l'arrangement.
 *
 * Mémoïsé sur la forme du graphe : éditer un slot ou un texte ne recalcule
 * rien, seul un Document ou un lien ajouté, retiré ou redimensionné le fait.
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
): Pick<Project, "canvasLayout" | "canvasGroups" | "canvasEdges"> | null {
  const groups = normalizeCanvasGroups(
    project.canvasGroups,
    project.menus.map((m) => m.id),
  );
  const target = groups.find((g) => g.id === groupId);
  if (groupId !== undefined && !target) return null;
  if (!groups.length)
    return { canvasLayout: {} as Project["canvasLayout"], canvasGroups: groups, canvasEdges: {} };

  const before = projectBoard(project);
  const members = new Set(target?.menuIds ?? []);
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
  });
  const canvasLayout = Object.fromEntries(
    graph.nodes.map((node) => [node.docId, arranged.positions[node.key]!]),
  ) as Project["canvasLayout"];
  const membership = new Map(groups.flatMap((g) => g.menuIds.map((id) => [id, g.id] as const)));
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
