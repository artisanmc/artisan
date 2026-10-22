import { projectNamespace } from "@/domain/docRef";
import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { allDocuments, commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { Project } from "@/domain/types";
import type { SearchEntry } from "@/features/search/searchIndex";
import { getText } from "@/lib/i18n";
import { type ModuleCommandsInput, moduleCommandsOf } from "@/lib/moduleCommands";
import { documentTitle } from "@/lib/moduleDocumentKinds";
import { projectUrlId } from "@/lib/projectUrlId";
import { documentKindContribution } from "@artisan/editor-sdk";

/** `menu`, `command`, `dialog` or a module's kind. */
export type IndexedKind = string;

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

/**
 * A project's Documents, in menus, commands, dialogs, module kinds order, then the
 * commands its module declares (listed with its own, as the sidebar shows them). Pure.
 */
export function indexProjectDocuments(
  project: Project,
  lang: string,
  moduleCommands?: ModuleCommandsInput,
): IndexedDocument[] {
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
    ...allDocuments(project)
      .filter(({ kind }) => !CORE_KINDS.has(kind))
      .map(({ kind, doc: d }) =>
        doc(d.id, kind, documentTitle(documentKindContribution(kind), d, project, lang)),
      ),
    ...(moduleCommands ? moduleCommandsOf(project, moduleCommands) : []).map((node) =>
      doc(node.id, "command", `/${node.label}`),
    ),
  ];
}

const CORE_KINDS = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

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
