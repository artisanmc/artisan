import type { Project } from "@/domain/types";
import { arrangeBoard } from "./arrangeBoard";
import { deriveServerGraph } from "./serverGraph";

type Point = { x: number; y: number };

export interface ProjectBoard {
  layout: Record<string, Point>;
  gutter: Point | null;
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
    graph.nodes.map((n) => [n.key, n.width, n.height]),
    graph.edges.map((e) => e.id),
    pinned,
  ]);
  const cached = bySignature.get(signature);
  if (cached) return cached;

  const { positions, gutter } = arrangeBoard({ nodes: graph.nodes, edges: graph.edges, pinned });
  const board: ProjectBoard = { layout: {}, gutter };
  for (const node of graph.nodes) board.layout[node.docId] = positions[node.key]!;
  if (bySignature.size > 64) bySignature.clear();
  bySignature.set(signature, board);
  return board;
}

export function autoLayout(project: Project): Record<string, Point> {
  return projectBoard(project).layout;
}
