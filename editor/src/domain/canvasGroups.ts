import { allDocuments, documentIds } from "./documents";
import type { CanvasGroup, Project } from "./types";

/** Every Document id in a project. */
export const liveDocumentIds = (project: Project): string[] => documentIds(project);

export const DEFAULT_GROUP_COLOR = "#60a5fa";
export const isGroupColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/**
 * The board's frames: one per top-level themed folder holding at least one
 * Document (at any depth), in name order. Color and position come from
 * `Project.folders`.
 */
export function folderGroups(project: Pick<Project, "documents" | "folders">): CanvasGroup[] {
  const members = new Map<string, string[]>();
  for (const { doc } of allDocuments(project as Project)) {
    if (!doc.folder) continue;
    const top = doc.folder.split("/")[0]!;
    const list = members.get(top) ?? [];
    list.push(doc.id);
    members.set(top, list);
  }
  return [...members.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => {
      const meta = project.folders?.[name];
      return {
        id: name,
        name,
        nodeIds: members.get(name)!,
        ...(meta?.color ? { color: meta.color } : {}),
        ...(meta?.position ? { position: { ...meta.position } } : {}),
      };
    });
}
