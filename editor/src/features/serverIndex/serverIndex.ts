import { projectNamespace } from "@/domain/docRef";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { Project } from "@/domain/types";
import type { SearchEntry } from "@/features/search/searchIndex";
import { getText } from "@/lib/i18n";
import { projectUrlId } from "@/lib/projectUrlId";
import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";

export type IndexedKind = "menu" | "command" | "dialog";

/**
 * A Document of a server project, seen from outside that project. `ref` is
 * its qualified identity (`<folder>:<id>`): the disk folder name is the
 * namespace, so the same id in two projects stays two Documents.
 */
export interface IndexedDocument {
  ref: string;
  namespace: string;
  projectName: string;
  /** The project id the editor's URLs expect. */
  urlId: string;
  docId: string;
  kind: IndexedKind;
  label: string;
}

export const namespaceOf = (project: Project): string => projectNamespace(project);

/** A project's Documents, in menus, commands, dialogs order. Pure. */
export function indexProjectDocuments(project: Project, lang: string): IndexedDocument[] {
  const namespace = namespaceOf(project);
  const common = { namespace, projectName: project.name, urlId: projectUrlId(project) };
  const doc = (docId: string, kind: IndexedKind, label: string): IndexedDocument => ({
    ...common,
    ref: `${namespace}:${docId}`,
    docId,
    kind,
    label,
  });
  return [
    ...menusOf(project).map((menu) => {
      const title = getFirstTitleText(menu);
      return doc(menu.id, "menu", (title ? getText(project, title, lang) : "") || menu.id);
    }),
    ...commandsOf(project).map((command) => doc(command.id, "command", `/${command.name}`)),
    ...dialogsOf(project).map((dialog) =>
      doc(dialog.id, "dialog", getText(project, dialog.title, lang) || dialog.id),
    ),
  ];
}

/**
 * Other projects' Documents, in the search palette's format. The project name
 * is the result's "context": it says where it lives, and the palette searches
 * it too (a project name finds its Documents).
 */
export function toSearchEntries(documents: IndexedDocument[]): SearchEntry[] {
  return documents.map((d) => {
    const context = { key: "search.ctxInProject", owner: d.projectName };
    return {
      id: `${d.kind}:${d.ref}`,
      group: d.kind,
      label: d.label,
      context,
      haystack: `${d.label} ${d.projectName} ${d.ref}`.toLowerCase(),
      target: { openId: d.docId, projectUrlId: d.urlId },
    };
  });
}
