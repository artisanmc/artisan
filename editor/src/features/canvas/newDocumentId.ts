import { hasDocument } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

/**
 * Id validation shared by every "new Document" dialog. Ids are unique across the
 * whole project, whatever the kind (core or module): the check goes through
 * `hasDocument`, never a hand-picked list of kinds.
 */

/** `base` when free, else the first free `base_1`, `base_2`, … */
export function uniqueDocumentId(project: Pick<Project, "documents"> | undefined, base: string) {
  if (!project || !hasDocument(project, base)) return base;
  let n = 1;
  while (hasDocument(project, `${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Whether a Document of any kind of the project already holds `id` (`""` is never taken). */
export function useDocumentIdTaken(projectId: ProjectId, id: string): boolean {
  return useAccountStore((s) => {
    if (id === "") return false;
    const project = s.account.projects.find((p) => p.id === projectId);
    return !!project && hasDocument(project, id);
  });
}

/** `uniqueDocumentId` against the live project (`""` for an empty base). */
export function useUniqueDocumentId(projectId: ProjectId, base: string): string {
  return useAccountStore((s) => {
    if (base === "") return "";
    return uniqueDocumentId(
      s.account.projects.find((p) => p.id === projectId),
      base,
    );
  });
}
