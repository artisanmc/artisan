/**
 * Document kinds (ADR `extensible-document-kinds`, decision 1 and 10).
 *
 * A Project holds Documents of several kinds; the three the core ships (menu,
 * command, dialog) are the first entries of this registry, and a module adds its
 * own the same way. Everything that used to know the closed list — the project
 * folder layout, id minting, the board gutter — reads this registry instead.
 *
 * Data only: parse/serialize and the editing surfaces live beside the code that
 * owns them (`schema/documentCodecs.ts`, the module's `FrontendModule`).
 */
export interface DocumentKindDef {
  /** The kind id, also the key of `Project.documents` ("menu"). */
  kind: string;
  /** Folder of the kind inside a project, without slash ("menus"). */
  dir: string;
  /** Prefix of a freshly minted id ("m_"); absent = ids are typed by hand. */
  idPrefix?: string;
  /** `schema:` written in a new file of this kind ("menu/v1"). */
  schemaVersion: string;
  /** Rank of the kind's orphans in the board gutter (`arrangeBoard`); lower first. */
  rank: number;
}

export const MENU_KIND: DocumentKindDef = {
  kind: "menu",
  dir: "menus",
  idPrefix: "m_",
  schemaVersion: "menu/v1",
  rank: 0,
};
export const COMMAND_KIND: DocumentKindDef = {
  kind: "command",
  dir: "commands",
  idPrefix: "c_",
  schemaVersion: "command/v1",
  rank: 2,
};
export const DIALOG_KIND: DocumentKindDef = {
  kind: "dialog",
  dir: "dialogs",
  schemaVersion: "dialog/v1",
  rank: 1,
};

export const CORE_DOCUMENT_KINDS: readonly DocumentKindDef[] = [
  MENU_KIND,
  COMMAND_KIND,
  DIALOG_KIND,
];

const kinds = new Map<string, DocumentKindDef>();
const listeners = new Set<() => void>();
let generation = 0;

/**
 * Bumped by every registration: a value read from files with the kinds of an older
 * generation may lack the Documents of a kind registered since (a module's view that
 * arrived after the read).
 */
export function documentKindsGeneration(): number {
  return generation;
}

/** Called after each registration; returns the unsubscribe. */
export function subscribeDocumentKinds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Registers a kind. Two kinds may not share a kind id, a folder, or an id
 * prefix: the board keys a Document by kind and id (`docKey`), and the prefix keeps
 * the ids a user reads apart.
 */
export function registerDocumentKind(def: DocumentKindDef): void {
  for (const other of kinds.values()) {
    if (other.kind === def.kind) throw new Error(`duplicate document kind: ${def.kind}`);
    if (other.dir === def.dir)
      throw new Error(`document kinds ${other.kind} and ${def.kind} share the folder ${def.dir}/`);
    if (def.idPrefix && other.idPrefix === def.idPrefix)
      throw new Error(
        `document kinds ${other.kind} and ${def.kind} share the id prefix ${def.idPrefix}`,
      );
  }
  kinds.set(def.kind, def);
  generation++;
  for (const listener of listeners) listener();
}

/** Every registered kind in registration order, the core kinds first — the order of folders and listings. */
export function listDocumentKinds(): DocumentKindDef[] {
  return [...kinds.values()];
}

export function documentKindDef(kind: string): DocumentKindDef {
  const def = kinds.get(kind);
  if (!def) throw new Error(`unknown document kind: ${kind}`);
  return def;
}

export function isDocumentKind(kind: string): boolean {
  return kinds.has(kind);
}

/** The kind whose folder is `dir` ("menus" → menu), if registered. */
export function documentKindByDir(dir: string): DocumentKindDef | undefined {
  for (const def of kinds.values()) if (def.dir === dir) return def;
  return undefined;
}

/** Test-only: back to the core kinds. */
export function resetDocumentKinds(): void {
  kinds.clear();
  for (const def of CORE_DOCUMENT_KINDS) registerDocumentKind(def);
}

for (const def of CORE_DOCUMENT_KINDS) registerDocumentKind(def);
