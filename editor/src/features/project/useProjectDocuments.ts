// Pure selectors for the workspace panel. File is named `useProjectDocuments`
// to anchor a future React-hook wrapper; for now only the pure
// `buildProjectDocuments` is needed (ProjectPanel calls it directly).
import { CORE_DOCUMENT_KINDS, listDocumentKinds } from "@/domain/documentKinds";
import { allDocuments, findDocument } from "@/domain/documents";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { Command, Dialog, Document, Menu, Project } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { documentTitle } from "@/lib/moduleDocumentKinds";
import { documentKindContribution } from "@artisan/editor-sdk";

/** A Document kind: `menu`, `command`, `dialog`, or one a module contributes. */
export type DocumentType = string;
export interface ProjectDocumentItem {
  id: string;
  label: string;
  type: DocumentType;
}
export interface ProjectDocumentGroup {
  type: DocumentType;
  items: ProjectDocumentItem[];
}

const CORE = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

/**
 * The core kinds' titles, for when their modules are not registered (a surface rendered
 * on its own, in a test). Registered, their contribution's `title` says the same thing.
 */
function coreTitle(project: Project, kind: string, doc: Document, activeLang: string): string {
  if (kind === "menu") {
    const lt = getFirstTitleText(doc as Menu);
    return (lt ? getText(project, lt, activeLang) : "") || doc.id;
  }
  if (kind === "command") return `/${(doc as Command).name}`;
  if (kind === "dialog") return getText(project, (doc as Dialog).title, activeLang) || doc.id;
  return doc.id;
}

/** Human-readable label for any Document id in the project, through its kind; fallback to the id. */
export function documentLabel(project: Project, id: string, activeLang: string): string {
  const found = findDocument(project, id);
  if (!found) return id;
  const contribution = documentKindContribution(found.kind);
  if (contribution) return documentTitle(contribution, found.doc, project, activeLang);
  return coreTitle(project, found.kind, found.doc, activeLang);
}

/** Does the panel list this kind by its title rather than its id? */
function listedByTitle(kind: string): boolean {
  const contribution = documentKindContribution(kind);
  // Menus and dialogs are labelled by their id in the panel (their title is
  // decorative, often empty or ambiguous — not a stable identifier).
  // Commands keep their human label (`/name` IS their identifier).
  if (contribution) return contribution.listByTitle ?? false;
  return kind === "command";
}

/**
 * Pure: builds the project's categorised Document list (the panel's source of truth),
 * one group per registered kind in registry order, then the kinds present in the project
 * that no module registered (their files were read, their editor is absent).
 */
export function buildProjectDocuments(
  project: Project,
  activeLang: string,
): ProjectDocumentGroup[] {
  const groups = new Map<string, ProjectDocumentGroup>();
  for (const def of listDocumentKinds()) groups.set(def.kind, { type: def.kind, items: [] });
  for (const { kind, doc } of allDocuments(project)) {
    let group = groups.get(kind);
    if (!group) {
      group = { type: kind, items: [] };
      groups.set(kind, group);
    }
    group.items.push({
      id: doc.id,
      label: listedByTitle(kind) ? documentLabel(project, doc.id, activeLang) : doc.id,
      type: kind,
    });
  }
  return [...groups.values()];
}

/** Is this kind one of the editor's own (menu, command, dialog)? */
export const isCoreDocumentType = (type: DocumentType): boolean => CORE.has(type);
