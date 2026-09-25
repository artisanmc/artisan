import type { Project, ProjectId } from "@/domain/types";
import { type Edge, deriveEdges } from "./deriveEdges";
import { COMMAND_BOX, DIALOG_BOX, menuBoxSize } from "./menuLayout";

export type DocumentKind = "menu" | "command" | "dialog";

export interface BoardNode {
  key: string;
  projectId: ProjectId;
  docId: string;
  kind: DocumentKind;
  width: number;
  height: number;
}

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  edge: Edge;
}

export interface UnresolvedLink {
  source: string;
  targetId: string;
  reason: "missing" | "ambiguous";
}

export interface ServerGraph {
  nodes: BoardNode[];
  edges: BoardEdge[];
  unresolved: UnresolvedLink[];
}

export const documentKey = (projectId: string, docId: string): string => `${projectId}/${docId}`;

const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/**
 * Le graphe de navigation de tout un serveur. Le plugin range menus et dialogs
 * dans une table unique indexée par id, sans notion de project : une cible se
 * résout donc sur tout le serveur. Un id porté par deux projects est ambigu —
 * le jeu en prendrait un arbitrairement, la planche refuse de deviner.
 */
export function deriveServerGraph(projects: Project[]): ServerGraph {
  const nodes: BoardNode[] = [];
  const targets = new Map<string, string[]>();
  const addTarget = (docId: string, key: string) => {
    targets.set(docId, [...(targets.get(docId) ?? []), key]);
  };

  for (const project of projects) {
    for (const menu of project.menus) {
      const key = documentKey(project.id, menu.id);
      nodes.push({
        key,
        projectId: project.id,
        docId: menu.id,
        kind: "menu",
        ...menuBoxSize(menu.inventoryType ?? "chest", menu.rows),
      });
      addTarget(menu.id, key);
    }
    for (const command of project.commands) {
      nodes.push({
        key: documentKey(project.id, command.id),
        projectId: project.id,
        docId: command.id,
        kind: "command",
        ...COMMAND_BOX,
      });
    }
    for (const dialog of project.dialogs ?? []) {
      const key = documentKey(project.id, dialog.id);
      nodes.push({ key, projectId: project.id, docId: dialog.id, kind: "dialog", ...DIALOG_BOX });
      addTarget(dialog.id, key);
    }
  }

  const edges: BoardEdge[] = [];
  const unresolved: UnresolvedLink[] = [];
  for (const project of projects) {
    for (const edge of deriveEdges(project)) {
      const source = documentKey(project.id, edge.source);
      const candidates = targets.get(edge.target) ?? [];
      if (candidates.length !== 1) {
        unresolved.push({
          source,
          targetId: edge.target,
          reason: candidates.length === 0 ? "missing" : "ambiguous",
        });
        continue;
      }
      const target = candidates[0]!;
      edges.push({ id: `${source}->${target}`, source, target, edge });
    }
  }

  nodes.sort(byKey);
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  unresolved.sort((a, b) =>
    a.source !== b.source ? (a.source < b.source ? -1 : 1) : a.targetId < b.targetId ? -1 : 1,
  );
  return { nodes, edges, unresolved };
}
