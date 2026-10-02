import { projectNamespace, resolveDocRef } from "@/domain/docRef";
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

interface Target {
  key: string;
  projectId: string;
  namespace: string;
}

/**
 * Le graphe de navigation de tout un serveur, avec la résolution lexicale des
 * références (`parseDocRef`) : un id nu vise d'abord son propre project, puis
 * le serveur s'il n'y est défini qu'une fois ; `project:id` vise ce project.
 * Un id nu absent du project et porté par deux autres est ambigu : la planche
 * refuse de deviner.
 */
export function deriveServerGraph(projects: Project[]): ServerGraph {
  const nodes: BoardNode[] = [];
  const targets = new Map<string, Target[]>();
  const addTarget = (project: Project, docId: string, key: string) => {
    const target = { key, projectId: project.id, namespace: projectNamespace(project) };
    targets.set(docId, [...(targets.get(docId) ?? []), target]);
  };
  const candidatesFor = (from: Project, raw: string): Target[] =>
    resolveDocRef((id) => targets.get(id) ?? [], from.id, raw);

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
      addTarget(project, menu.id, key);
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
      addTarget(project, dialog.id, key);
    }
  }

  const edges: BoardEdge[] = [];
  const unresolved: UnresolvedLink[] = [];
  for (const project of projects) {
    for (const edge of deriveEdges(project)) {
      const source = documentKey(project.id, edge.source);
      const candidates = candidatesFor(project, edge.target);
      if (candidates.length !== 1) {
        unresolved.push({
          source,
          targetId: edge.target,
          reason: candidates.length === 0 ? "missing" : "ambiguous",
        });
        continue;
      }
      const target = candidates[0]!.key;
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
