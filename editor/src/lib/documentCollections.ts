import { allDocuments, docKey, documentsOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import {
  type DocumentKindContribution,
  documentKindContribution,
  listDocumentKindContributions,
} from "@artisan/editor-sdk";
import { kindCreatableIn } from "./moduleDocumentKinds";

/**
 * The host side of `DocumentKindContribution.collection` (SDK 1.9): a kind whose Documents
 * form one container (a shop's catalogue). Its Documents get no board node, never enter a
 * themed folder, and are listed by the collection's sidebar entry and page.
 */
export function isCollectionKind(kind: string): boolean {
  return documentKindContribution(kind)?.collection != null;
}

/** The collection kind stored in `dir` (its page's URL segment), if any. */
export function collectionKindOfDir(dir: string): string | undefined {
  return listDocumentKindContributions().find((c) => c.collection != null && c.dir === dir)?.kind;
}

/** The kinds a project shows as collections: creatable there, or already holding Documents. */
export function projectCollections(
  project: Pick<Project, "id" | "diskId" | "documents">,
): DocumentKindContribution[] {
  return listDocumentKindContributions().filter(
    (c) =>
      c.collection != null &&
      (kindCreatableIn(c, project) || documentsOf(project as Project, c.kind).length > 0),
  );
}

/** A collection's name in the interface language, else in English, else the kind id. */
export function collectionLabel(
  c: DocumentKindContribution | undefined,
  kind: string,
  lang: string,
) {
  const labels = c?.collection?.labels;
  return labels?.[lang] ?? labels?.en ?? kind;
}

/** The keys of every collection Document still filed in a themed folder. */
export function misplacedCollectionDocuments(project: Project): string[] {
  return allDocuments(project)
    .filter(({ kind, doc }) => !!doc.folder && isCollectionKind(kind))
    .map(({ kind, doc }) => docKey(kind, doc.id));
}
