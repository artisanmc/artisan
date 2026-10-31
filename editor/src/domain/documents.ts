import { documentKindDef, listDocumentKinds } from "./documentKinds";
import { documentPath } from "./documentLayout";
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

/**
 * A Document's key on the board and in every kind-agnostic lookup: `<kind>/<id>`. An id is
 * unique within its kind only (`project-files.md`): a menu `shop` and a command `shop` are
 * two Documents, so position, selection, links and Properties key them by kind and id. A
 * kind or an id never holds `/`.
 */
export type DocKey = `${string}/${string}`;

export const docKey = (kind: string, id: string): DocKey => `${kind}/${id}`;

export const isDocKey = (value: string): value is DocKey => value.includes("/");

export function parseDocKey(key: string): { kind: string; id: string } | null {
  const at = key.indexOf("/");
  return at <= 0 ? null : { kind: key.slice(0, at), id: key.slice(at + 1) };
}

/** The key of every document, in `allDocuments` order. */
export function documentKeys(project: Documents): DocKey[] {
  return allDocuments(project).map((d) => docKey(d.kind, d.doc.id));
}

/** The document of that key. */
export function findDocumentByKey(project: Documents, key: string): KindedDocument | undefined {
  const parsed = parseDocKey(key);
  if (!parsed) return undefined;
  const doc = documentsOf(project, parsed.kind).find((d) => d.id === parsed.id);
  return doc ? { kind: parsed.kind, doc } : undefined;
}

/** The document a key designates, or the first of a bare id (`resolveDocKey`). */
export function findDocumentRef(project: Documents, keyOrId: string): KindedDocument | undefined {
  return isDocKey(keyOrId) ? findDocumentByKey(project, keyOrId) : findDocument(project, keyOrId);
}

/**
 * The key a link or a URL designates: a key as is, a bare id (an older `?doc=`, a module's
 * call) as the first document of that id in `allDocuments` order.
 */
export function resolveDocKey(project: Documents, keyOrId: string): DocKey | undefined {
  if (isDocKey(keyOrId)) return findDocumentByKey(project, keyOrId) ? keyOrId : undefined;
  const found = allDocuments(project).find((d) => d.doc.id === keyOrId);
  return found ? docKey(found.kind, found.doc.id) : undefined;
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

/**
 * The first document with that id, whatever its kind. Two kinds may share an id: a lookup
 * that does not know the kind goes through a key (`findDocumentByKey`).
 */
export function findDocument(project: Documents, id: string): KindedDocument | undefined {
  for (const [kind, docs] of Object.entries(project.documents)) {
    const doc = docs.find((d) => d.id === id);
    if (doc) return { kind, doc };
  }
  return undefined;
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

/**
 * The move a rename makes on disk, relative to the module folder: the file keeps
 * its kind folder and its themed folder, only its name changes. Read after the
 * rename, under `newId`.
 */
export function renamedDocumentFiles(
  project: Documents | null | undefined,
  kind: string,
  oldId: string,
  newId: string,
): { from: string; to: string } {
  const dir = documentKindDef(kind).dir;
  const folder = documentsOf(project, kind).find((d) => d.id === newId)?.folder;
  return { from: documentPath(dir, oldId, folder), to: documentPath(dir, newId, folder) };
}
