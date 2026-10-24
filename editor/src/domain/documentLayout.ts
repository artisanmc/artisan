/**
 * Where a module's Documents live on disk: `<folders…>/<kind dir>/<id>.yml`
 * (or `.yaml`, `lib/yamlFiles.ts`; the same id under both is a `duplicate_id`).
 *
 * Zero to {@link MAX_FOLDER_DEPTH} themed folders group Documents of any kind;
 * under each, the kind folders (`menus/`, `commands/`, a module's `quest_groups/`)
 * hold files only, exactly as at the module root. The id is the file name:
 * moving a Document between folders changes no reference, no `lang/` key, no
 * board key. One id per kind across the whole module.
 *
 * Mirror of the plugin's `DocumentLayout.kt`, locked by
 * `testdata/document-layout-conformance.json`.
 */

import { yamlStem } from "@/lib/yamlFiles";

/** Module-root folders that are never themed folders: resources, overrides, config. */
export const RESOURCE_DIRS: ReadonlySet<string> = new Set([
  "lang",
  "items",
  "data",
  "models",
  "templates",
  "assets",
  "overrides",
  "config",
]);

export const MAX_FOLDER_DEPTH = 3;

const FOLDER_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** A Document found on disk. `folder` is the themed path, `""` at the module root. */
export interface LayoutEntry {
  path: string;
  dir: string;
  id: string;
  folder: string;
}

export type LayoutErrorReason =
  | "duplicate_id"
  | "kind_dir_subfolder"
  | "reserved_folder"
  | "invalid_folder"
  | "too_deep";

/** A file shaped like a Document that is refused. */
export interface LayoutError {
  path: string;
  reason: LayoutErrorReason;
}

export interface LayoutResult {
  documents: LayoutEntry[];
  errors: LayoutError[];
}

/** Whether `name` may name a themed folder (slug, not a resource folder, not a kind folder). */
export function isValidFolderName(name: string, kindDirs: ReadonlySet<string>): boolean {
  return FOLDER_RE.test(name) && !RESOURCE_DIRS.has(name) && !kindDirs.has(name);
}

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function classifyOne(
  path: string,
  kindDirs: ReadonlySet<string>,
): LayoutEntry | LayoutError | null {
  const segs = path.split("/");
  if (segs.some((s) => s.length === 0 || s.startsWith("."))) return null;
  const file = segs[segs.length - 1]!;
  const id = yamlStem(file);
  if (id === null) return null;
  const dirs = segs.slice(0, -1);
  if (dirs.length === 0 || RESOURCE_DIRS.has(dirs[0]!)) return null;
  const kindAt = dirs.findIndex((d) => kindDirs.has(d));
  if (kindAt < 0) return null;
  if (kindAt !== dirs.length - 1) return { path, reason: "kind_dir_subfolder" };
  const folders = dirs.slice(0, kindAt);
  for (const f of folders) {
    if (RESOURCE_DIRS.has(f)) return { path, reason: "reserved_folder" };
    if (!FOLDER_RE.test(f)) return { path, reason: "invalid_folder" };
  }
  if (folders.length > MAX_FOLDER_DEPTH) return { path, reason: "too_deep" };
  return {
    path,
    dir: dirs[kindAt]!,
    id,
    folder: folders.join("/"),
  };
}

/**
 * Classifies `paths` (relative to the module folder, `/`-separated) against the
 * registered `kindDirs`. Paths that are not Documents at all (resources,
 * metadata, loose files, unregistered kind folders) appear in neither list.
 */
export function classifyDocumentLayout(
  paths: Iterable<string>,
  kindDirs: ReadonlySet<string>,
): LayoutResult {
  const candidates: LayoutEntry[] = [];
  const errors: LayoutError[] = [];
  for (const path of [...paths].sort(byteOrder)) {
    const r = classifyOne(path, kindDirs);
    if (r === null) continue;
    if ("reason" in r) errors.push(r);
    else candidates.push(r);
  }
  const count = new Map<string, number>();
  for (const e of candidates) {
    const key = `${e.dir}\u0000${e.id}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const documents: LayoutEntry[] = [];
  for (const e of candidates) {
    if ((count.get(`${e.dir}\u0000${e.id}`) ?? 0) > 1)
      errors.push({ path: e.path, reason: "duplicate_id" });
    else documents.push(e);
  }
  errors.sort((a, b) => byteOrder(a.path, b.path));
  return { documents, errors };
}

/** The file of a Document, relative to the module folder. */
export function documentPath(dir: string, id: string, folder?: string): string {
  return folder ? `${folder}/${dir}/${id}.yaml` : `${dir}/${id}.yaml`;
}
