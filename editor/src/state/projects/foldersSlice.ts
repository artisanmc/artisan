import { isGroupColor } from "@/domain/canvasGroups";
import { documentKindDef, isDocumentKind } from "@/domain/documentKinds";
import { documentPath } from "@/domain/documentLayout";
import { allDocuments } from "@/domain/documents";
import {
  type FolderError,
  isWithin,
  listFolders,
  newFolderError,
  parentFolder,
} from "@/domain/folders";
import type { Project, ProjectId } from "@/domain/types";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import type { ProjectsSliceContext } from "./types";

/** Themed folders: create, rename, delete, file Documents (`domain/folders.ts`). */
export interface FoldersSlice {
  /** Creates an empty folder in `parent` (`""`: the module root); returns its path. */
  createFolder: (input: { projectId: ProjectId; parent: string; name: string }) => string;
  /** Files Documents in `folder` (`""`: the module root). */
  moveToFolder: (input: { projectId: ProjectId; nodeIds: string[]; folder: string }) => void;
  /** Renames a folder in place; what it holds follows. */
  renameFolder: (input: { projectId: ProjectId; path: string; name: string }) => string;
  /** Removes a folder; what it holds moves up into its parent. */
  deleteFolder: (input: { projectId: ProjectId; path: string }) => void;
  setFolderColor: (input: { projectId: ProjectId; path: string; color: string }) => void;
}

export class FolderOperationError extends Error {
  constructor(readonly code: FolderError) {
    super(`folder: ${code}`);
  }
}

const LAYOUT = { touch: false } as const;

type Move = { from: string; to: string };

/** Sets each Document's folder through `refile`, returning the file moves it makes. */
function refileDocuments(
  project: Project,
  refile: (folder: string, id: string) => string | null,
): Move[] {
  const moves: Move[] = [];
  for (const { kind, doc } of allDocuments(project)) {
    const before = doc.folder ?? "";
    const after = refile(before, doc.id);
    if (after === null || after === before) continue;
    if (after) doc.folder = after;
    // biome-ignore lint/performance/noDelete: a root Document carries no folder field
    else delete doc.folder;
    if (!isDocumentKind(kind)) continue;
    const dir = documentKindDef(kind).dir;
    moves.push({ from: documentPath(dir, doc.id, before), to: documentPath(dir, doc.id, after) });
  }
  return moves;
}

/** Re-keys `Project.folders` entries at or under `from` with `rename`. */
function rekeyMeta(project: Project, from: string, rename: (path: string) => string) {
  if (!project.folders) return;
  const next: NonNullable<Project["folders"]> = {};
  for (const [path, meta] of Object.entries(project.folders)) {
    const key = isWithin(path, from) ? rename(path) : path;
    if (key) next[key] = { ...next[key], ...meta };
  }
  project.folders = next;
}

export const createFoldersSlice = ({ get, mutateProject }: ProjectsSliceContext): FoldersSlice => {
  const project = (pId: ProjectId) => {
    const p = get().openProjects.projects.find((x) => x.id === pId);
    if (!p) throw new Error("project not found");
    return p;
  };
  const record = (pId: ProjectId, moves: Move[]) => {
    const drafts = useProjectDraftStore.getState();
    for (const m of moves) drafts.recordRename(pId, m.from, m.to);
  };
  return {
    createFolder: ({ projectId: pId, parent, name }) => {
      const error = newFolderError(project(pId), parent, name);
      if (error) throw new FolderOperationError(error);
      const path = parent ? `${parent}/${name}` : name;
      mutateProject(
        pId,
        (p) => {
          p.folders = { ...p.folders, [path]: {} };
        },
        LAYOUT,
      );
      return path;
    },
    moveToFolder: ({ projectId: pId, nodeIds, folder }) => {
      if (folder && !listFolders(project(pId)).includes(folder)) throw new Error("unknown folder");
      const ids = new Set(nodeIds);
      let moves: Move[] = [];
      mutateProject(pId, (p) => {
        moves = refileDocuments(p, (_, id) => (ids.has(id) ? folder : null));
        if (moves.length === 0) return false;
        // A Document that changes frame is laid out again inside its new one.
        for (const id of ids) delete (p.canvasLayout as Record<string, unknown>)[id];
      });
      record(pId, moves);
    },
    renameFolder: ({ projectId: pId, path, name }) => {
      const current = project(pId);
      if (!listFolders(current).includes(path)) throw new Error("unknown folder");
      const parent = parentFolder(path);
      const target = parent ? `${parent}/${name}` : name;
      if (target === path) return path;
      const error = newFolderError(current, parent, name);
      if (error) throw new FolderOperationError(error);
      const rename = (p: string) => target + p.slice(path.length);
      let moves: Move[] = [];
      mutateProject(pId, (p) => {
        moves = refileDocuments(p, (folder) => (isWithin(folder, path) ? rename(folder) : null));
        rekeyMeta(p, path, rename);
      });
      record(pId, moves);
      return target;
    },
    deleteFolder: ({ projectId: pId, path }) => {
      const parent = parentFolder(path);
      // `boutique/armes/epees` without `armes` → `boutique/epees`.
      const lift = (p: string) => {
        const rest = p.slice(path.length + 1);
        return [parent, rest].filter(Boolean).join("/");
      };
      let moves: Move[] = [];
      mutateProject(pId, (p) => {
        moves = refileDocuments(p, (folder) => (isWithin(folder, path) ? lift(folder) : null));
        rekeyMeta(p, path, (meta) => (meta === path ? "" : lift(meta)));
      });
      record(pId, moves);
    },
    setFolderColor: ({ projectId: pId, path, color }) => {
      if (!isGroupColor(color)) return;
      mutateProject(
        pId,
        (p) => {
          p.folders = { ...p.folders, [path]: { ...p.folders?.[path], color } };
        },
        LAYOUT,
      );
    },
  };
};
