import { projectNamespace, resolveDocRef } from "@/domain/docRef";
import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import {
  type DocKey,
  allDocuments,
  commandsOf,
  dialogsOf,
  docKey,
  menusOf,
  parseDocKey,
} from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { type Edge, deriveEdges } from "./deriveEdges";
import { DIALOG_BOX, commandBox, documentBoxSize, menuBoxSize } from "./menuLayout";

/** A document kind id, as registered in `domain/documentKinds.ts`. */
export type DocumentKind = string;

export interface BoardNode {
  key: string;
  projectId: ProjectId;
  docId: string;
  /** Its key on its project's board (`docKey`): an id is unique within its kind only. */
  docKey: DocKey;
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

/** A Document's key on a server's board: its project, then its key on the project's board (`docKey`). */
export const documentKey = (projectId: string, key: DocKey): string => `${projectId}/${key}`;

const CORE = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

interface Target {
  key: string;
  projectId: string;
  namespace: string;
}

/**
 * The navigation graph of a whole server, with lexical resolution of
 * references (`parseDocRef`): a bare id targets its own project first, then
 * the server if it is defined there only once; `project:id` targets that
 * project. A bare id missing from the project and carried by two others is
 * ambiguous: the board refuses to guess.
 */
export function deriveServerGraph(projects: Project[]): ServerGraph {
  const nodes: BoardNode[] = [];
  const targets = new Map<string, Target[]>();
  // Targets by kind then id: a reference names the kind it opens.
  const addTarget = (project: Project, kind: string, docId: string, key: string) => {
    const target = { key, projectId: project.id, namespace: projectNamespace(project) };
    const at = docKey(kind, docId);
    targets.set(at, [...(targets.get(at) ?? []), target]);
  };
  const candidatesFor = (from: Project, kind: string, raw: string): Target[] =>
    resolveDocRef((id) => targets.get(docKey(kind, id)) ?? [], from.id, raw);

  for (const project of projects) {
    for (const menu of menusOf(project)) {
      const at = docKey("menu", menu.id);
      const key = documentKey(project.id, at);
      nodes.push({
        key,
        projectId: project.id,
        docId: menu.id,
        docKey: at,
        kind: "menu",
        ...menuBoxSize(menu.inventoryType ?? "chest", menu.rows),
      });
      addTarget(project, "menu", menu.id, key);
    }
    for (const command of commandsOf(project)) {
      const at = docKey("command", command.id);
      nodes.push({
        key: documentKey(project.id, at),
        projectId: project.id,
        docId: command.id,
        docKey: at,
        kind: "command",
        ...commandBox(command),
      });
    }
    for (const dialog of dialogsOf(project)) {
      const at = docKey("dialog", dialog.id);
      const key = documentKey(project.id, at);
      nodes.push({
        key,
        projectId: project.id,
        docId: dialog.id,
        docKey: at,
        kind: "dialog",
        ...DIALOG_BOX,
      });
      addTarget(project, "dialog", dialog.id, key);
    }
    // A module's kind: a node per Document, a target like any Document (a `document_ref`
    // of that kind may point at it).
    for (const { kind, doc } of allDocuments(project)) {
      if (CORE.has(kind)) continue;
      const at = docKey(kind, doc.id);
      const key = documentKey(project.id, at);
      nodes.push({
        key,
        projectId: project.id,
        docId: doc.id,
        docKey: at,
        kind,
        ...documentBoxSize(kind, doc, project),
      });
      addTarget(project, kind, doc.id, key);
    }
  }

  const edges: BoardEdge[] = [];
  const unresolved: UnresolvedLink[] = [];
  for (const project of projects) {
    for (const edge of deriveEdges(project)) {
      const source = documentKey(project.id, edge.source);
      const target = parseDocKey(edge.target)!;
      const candidates = candidatesFor(project, target.kind, target.id);
      if (candidates.length !== 1) {
        unresolved.push({
          source,
          targetId: target.id,
          reason: candidates.length === 0 ? "missing" : "ambiguous",
        });
        continue;
      }
      const to = candidates[0]!.key;
      edges.push({ id: `${source}->${to}`, source, target: to, edge });
    }
  }

  nodes.sort(byKey);
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  unresolved.sort((a, b) =>
    a.source !== b.source ? (a.source < b.source ? -1 : 1) : a.targetId < b.targetId ? -1 : 1,
  );
  return { nodes, edges, unresolved };
}
