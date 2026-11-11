import { listDocumentKinds } from "./documentKinds";
import { MAX_FOLDER_DEPTH, isValidFolderName } from "./documentLayout";
import { allDocuments } from "./documents";
import type { FolderMeta, Project } from "./types";

/**
 * Themed folders of a module (`domain/documentLayout.ts`): a folder exists while
 * a Document is filed in it or under it, or while `Project.folders` remembers it
 * (a folder just created, still empty).
 */

type Folders = Pick<Project, "documents" | "folders">;

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `boutique/armes` → `boutique`; a top-level folder → `""` (the module root). */
export function parentFolder(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** `boutique/armes` → `armes`. */
export function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether `path` is `folder` or lies under it. */
export function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** Every folder of the module, ancestors included, sorted (a parent before its children). */
export function listFolders(project: Folders): string[] {
  const out = new Set<string>();
  const add = (path: string | undefined) => {
    for (let p = path ?? ""; p; p = parentFolder(p)) out.add(p);
  };
  for (const { doc } of allDocuments(project as Project)) add(doc.folder);
  for (const path of Object.keys(project.folders ?? {})) add(path);
  return [...out].sort(byteOrder);
}

/** The folders directly inside `parent` (`""`: the module root). */
export function childFolders(project: Folders, parent: string): string[] {
  return listFolders(project).filter((p) => parentFolder(p) === parent);
}

/** Lowercase slug a typed name turns into: what a folder may be called on disk. */
export function slugifyFolderName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s.]+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+/, "");
}

export type FolderError = "invalid_name" | "too_deep" | "exists";

/** Why `name` cannot become a folder inside `parent`, or null when it can. */
export function newFolderError(project: Folders, parent: string, name: string): FolderError | null {
  const kindDirs = new Set(listDocumentKinds().map((d) => d.dir));
  if (!isValidFolderName(name, kindDirs)) return "invalid_name";
  const path = parent ? `${parent}/${name}` : name;
  if (path.split("/").length > MAX_FOLDER_DEPTH) return "too_deep";
  if (listFolders(project).includes(path)) return "exists";
  return null;
}

/** Tolerant reader of `.artisan/editor.yaml` `folders:`. */
export function normalizeFolderMeta(value: unknown): Record<string, FolderMeta> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const kindDirs = new Set(listDocumentKinds().map((d) => d.dir));
  const out: Record<string, FolderMeta> = {};
  for (const [path, raw] of Object.entries(value as Record<string, unknown>)) {
    const segments = path.split("/");
    if (
      segments.length > MAX_FOLDER_DEPTH ||
      !segments.every((s) => isValidFolderName(s, kindDirs))
    )
      continue;
    const meta: FolderMeta = {};
    const r = (raw ?? {}) as { color?: unknown; position?: { x?: unknown; y?: unknown } };
    if (typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color)) meta.color = r.color;
    const p = r.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      meta.position = { x: p.x as number, y: p.y as number };
    out[path] = meta;
  }
  return out;
}

/**
 * What `.artisan/editor.yaml` keeps: folders with a color or a position, and
 * empty ones (nothing on disk would remember them otherwise).
 */
export function persistedFolderMeta(project: Folders): Record<string, FolderMeta> {
  const filed = new Set<string>();
  for (const { doc } of allDocuments(project as Project)) {
    for (let p = doc.folder ?? ""; p; p = parentFolder(p)) filed.add(p);
  }
  const out: Record<string, FolderMeta> = {};
  for (const [path, meta] of Object.entries(project.folders ?? {}).sort(([a], [b]) =>
    byteOrder(a, b),
  )) {
    if (meta.color || meta.position || !filed.has(path)) out[path] = meta;
  }
  return out;
}
