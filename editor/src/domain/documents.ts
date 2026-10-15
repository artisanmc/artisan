import { listDocumentKinds } from "./documentKinds";
import type { Command, Dialog, Document, Menu, Project } from "./types";

/**
 * Read façade over `Project.documents` (ADR `extensible-document-kinds`,
 * decision 10). The container is the only store; these helpers are the
 * ergonomic way to read it, typed for the core kinds. A consumer that works
 * for any kind iterates `allDocuments` / `listDocumentKinds` and never spells
 * a kind name.
 */

type Documents = Pick<Project, "documents">;

/**
 * The documents of one kind — `[]` when the project holds none, or when there
 * is no project yet (a loading surface reads `menusOf(project)` as it read
 * `menusOf(project)` before).
 */
export function documentsOf(project: Documents | null | undefined, kind: string): Document[] {
  return project?.documents[kind] ?? [];
}

/** The live array of one kind on a draft, created on first write. */
export function mutableDocuments(project: Documents, kind: string): Document[] {
  let docs = project.documents[kind];
  if (!docs) {
    docs = [];
    project.documents[kind] = docs;
  }
  return docs;
}

export const menusOf = (project: Documents | null | undefined): Menu[] =>
  documentsOf(project, "menu") as Menu[];
export const commandsOf = (project: Documents | null | undefined): Command[] =>
  documentsOf(project, "command") as Command[];
export const dialogsOf = (project: Documents | null | undefined): Dialog[] =>
  documentsOf(project, "dialog") as Dialog[];

export const mutableMenus = (project: Documents): Menu[] =>
  mutableDocuments(project, "menu") as Menu[];
export const mutableCommands = (project: Documents): Command[] =>
  mutableDocuments(project, "command") as Command[];
export const mutableDialogs = (project: Documents): Dialog[] =>
  mutableDocuments(project, "dialog") as Dialog[];

export interface KindedDocument {
  kind: string;
  doc: Document;
}

/** Every document of the project, registered kinds first in registry order, then the rest. */
export function allDocuments(project: Documents): KindedDocument[] {
  const out: KindedDocument[] = [];
  const seen = new Set<string>();
  for (const def of listDocumentKinds()) {
    seen.add(def.kind);
    for (const doc of documentsOf(project, def.kind)) out.push({ kind: def.kind, doc });
  }
  for (const [kind, docs] of Object.entries(project.documents)) {
    if (seen.has(kind)) continue;
    for (const doc of docs) out.push({ kind, doc });
  }
  return out;
}

/** The ids of every document, in `allDocuments` order. */
export function documentIds(project: Documents): string[] {
  return allDocuments(project).map((d) => d.doc.id);
}

export function documentCount(project: Documents): number {
  let n = 0;
  for (const docs of Object.values(project.documents)) n += docs.length;
  return n;
}

/** The document with that id, whatever its kind. */
export function findDocument(project: Documents, id: string): KindedDocument | undefined {
  for (const [kind, docs] of Object.entries(project.documents)) {
    const doc = docs.find((d) => d.id === id);
    if (doc) return { kind, doc };
  }
  return undefined;
}

/** The kind of the document with that id, or undefined when no document has it. */
export function documentKindOf(project: Documents, id: string): string | undefined {
  return findDocument(project, id)?.kind;
}

export function hasDocument(project: Documents, id: string): boolean {
  return findDocument(project, id) !== undefined;
}

/** An empty container with the core kinds present, the shape of a new project. */
export function emptyDocuments(): Record<string, Document[]> {
  const out: Record<string, Document[]> = {};
  for (const def of listDocumentKinds()) out[def.kind] = [];
  return out;
}
