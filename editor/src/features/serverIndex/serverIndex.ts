import { getFirstTitleText } from "@/domain/menuTitle";
import type { Project } from "@/domain/types";
import type { SearchEntry } from "@/features/search/searchIndex";
import { getText } from "@/lib/i18n";
import { projectUrlId } from "@/lib/projectUrlId";

export type IndexedKind = "menu" | "command" | "dialog";

/**
 * Un Document d'un project du serveur, vu de l'extérieur de ce project. `ref` est
 * son identité qualifiée (`<dossier>:<id>`) : le nom du dossier disque est le
 * namespace, donc le même id dans deux projects reste deux Documents.
 */
export interface IndexedDocument {
  ref: string;
  namespace: string;
  projectName: string;
  /** L'identifiant de project qu'attendent les URLs de l'éditeur. */
  urlId: string;
  docId: string;
  kind: IndexedKind;
  label: string;
}

export const namespaceOf = (project: Project): string => project.diskId ?? project.id;

/** Les Documents d'un project, dans l'ordre menus, commandes, dialogs. Pur. */
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
    ...(project.menus ?? []).map((menu) => {
      const title = getFirstTitleText(menu);
      return doc(menu.id, "menu", (title ? getText(project, title, lang) : "") || menu.id);
    }),
    ...(project.commands ?? []).map((command) => doc(command.id, "command", `/${command.name}`)),
    ...(project.dialogs ?? []).map((dialog) =>
      doc(dialog.id, "dialog", getText(project, dialog.title, lang) || dialog.id),
    ),
  ];
}

/**
 * Les Documents d'autres projects, au format de la palette de recherche. Le nom
 * du project est le « contexte » du résultat : il dit où il vit, et la palette le
 * cherche aussi (un nom de project retrouve ses Documents).
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
