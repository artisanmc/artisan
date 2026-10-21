import { allDocuments } from "@/domain/documents";
import { isWithin, listFolders } from "@/domain/folders";
import type { Project } from "@/domain/types";
import type { ProjectBoard } from "./autoLayout";

/**
 * The board narrowed to one themed folder (`boutique`, `boutique/armes`): only
 * the Documents filed in it or under it keep their place, everything else
 * leaves `layout` and so the stage. Positions are the full board's: clearing
 * the filter moves nothing. A top-level folder keeps its frame; a sub-folder
 * has none of its own, and its parent's frame would wrap Documents now hidden.
 */
export function boardForFolder(
  project: Project,
  board: ProjectBoard,
  folder: string,
): ProjectBoard {
  const shown = new Set<string>(
    allDocuments(project)
      .filter(({ doc }) => doc.folder && isWithin(doc.folder, folder))
      .map(({ doc }) => doc.id),
  );
  return {
    ...board,
    layout: Object.fromEntries(Object.entries(board.layout).filter(([id]) => shown.has(id))),
    groups: board.groups.filter((g) => g.kind === "group" && g.id === folder),
  };
}

/** The filter to apply: `folder` while it still exists in the project, else none. */
export function activeBoardFolder(project: Project | undefined, folder: string | undefined) {
  return project && folder && listFolders(project).includes(folder) ? folder : undefined;
}
