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
 * **Variants** (design `variantes-modules`): when the module root holds
 * `variants.yml` (or `.yaml`), `variants/<name>/…` is no themed folder: each
 * `<name>` is a variant whose files follow the same layout, and its Documents
 * land in `variants`, ids unique per kind inside the variant. Without that file
 * nothing changes, even for a themed folder named `variants`.
 *
 * **Originals** (design `originaux-modules`): `originals/…` holds what the module
 * ships, laid out the same way (its variants included), written by the server only.
 * An original Document is read unless the owner has a Document of the same kind
 * and id (same variant) anywhere in the module, or `excluded` lists its path
 * (relative to `originals/`, from the module file). Those read carry `original`
 * and their `originals/…` path.
 *
 * Mirror of the plugin's `DocumentLayout.kt`, locked by
 * `testdata/document-layout-conformance.json`.
 */

import { YAML_EXT, yamlStem } from "@/lib/yamlFiles";

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

/** The module-root file (`variants.yml` or `.yaml`) that turns `variants/` into the variants' folder. */
export const VARIANTS_FILE = "variants";

/** The folder of the variants, at the module root. */
export const VARIANTS_DIR = "variants";

/** The folder of what the module ships, at the module root (design `originaux-modules`). */
export const ORIGINALS_DIR = "originals";

/** The index of the originals (module, version, required files), written by the server. */
export const ORIGINALS_INDEX = `${ORIGINALS_DIR}/originals.yml`;

/** Whether `path` (relative to the module folder) is one of the module's originals: the server's to write. */
export function isOriginalPath(path: string): boolean {
  return path.startsWith(`${ORIGINALS_DIR}/`);
}

const FOLDER_RE = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * A Document found on disk. `folder` is the themed path, `""` at the module root
 * (inside its variant for a variant's Document). `variant` is set only on a
 * variant's Document.
 */
export interface LayoutEntry {
  path: string;
  dir: string;
  id: string;
  folder: string;
  variant?: string;
  /** Read from `originals/`: no Document of the owner covers it. */
  original?: boolean;
}

export type LayoutErrorReason =
  | "duplicate_id"
  | "kind_dir_subfolder"
  | "reserved_folder"
  | "invalid_folder"
  | "too_deep"
  | "invalid_variant";

/** A file shaped like a Document that is refused. */
export interface LayoutError {
  path: string;
  reason: LayoutErrorReason;
}

export interface LayoutResult {
  documents: LayoutEntry[];
  errors: LayoutError[];
  /** The variants' Documents, each with its `variant`; empty without `variants.yml`. */
  variants: LayoutEntry[];
}

/** Whether `paths` hold the module-root file that declares variants, the owner's or the module's. */
export function hasVariants(paths: Iterable<string>): boolean {
  return variantsPath(paths) !== undefined;
}

/** The variants' rules file in effect: the owner's at the module root, else the module's in `originals/`. */
export function variantsPath(paths: Iterable<string>): string | undefined {
  const all = [...paths].sort(byteOrder);
  return (
    all.find((p) => !p.includes("/") && yamlStem(p) === VARIANTS_FILE) ??
    all.find(
      (p) =>
        isOriginalPath(p) &&
        p.split("/").length === 2 &&
        yamlStem(p.slice(ORIGINALS_DIR.length + 1)) === VARIANTS_FILE,
    )
  );
}

/** `menus/ranks.yml` and `menus/ranks.yaml` name the same file. */
export function sameFile(path: string): string {
  return yamlStem(path) ?? path;
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
  excluded: Iterable<string> = [],
): LayoutResult {
  const all = [...paths];
  const variantsOn = hasVariants(all);
  const prefix = `${ORIGINALS_DIR}/`;
  const own = tree(
    all.filter((p) => !p.startsWith(prefix)),
    kindDirs,
    variantsOn,
  );
  const shipped = tree(
    all.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)),
    kindDirs,
    variantsOn,
  );
  const covered = new Set(own.candidates.map(keyOf));
  const off = new Set([...excluded].map(sameFile));
  const originals = shipped.kept
    .filter((e) => !covered.has(keyOf(e)) && !off.has(sameFile(e.path)))
    .map((e): LayoutEntry => ({ ...e, path: prefix + e.path, original: true }));
  const kept = [...own.kept, ...originals].sort((a, b) => byteOrder(a.path, b.path));
  const errors = [
    ...own.errors,
    ...shipped.errors.map((e) => ({ ...e, path: prefix + e.path })),
  ].sort((a, b) => byteOrder(a.path, b.path));
  return {
    documents: kept.filter((e) => !e.variant),
    errors,
    variants: kept.filter((e) => !!e.variant),
  };
}

const keyOf = (e: LayoutEntry) => `${e.variant ?? ""}\u0000${e.dir}\u0000${e.id}`;

function tree(
  paths: string[],
  kindDirs: ReadonlySet<string>,
  variantsOn: boolean,
): { candidates: LayoutEntry[]; kept: LayoutEntry[]; errors: LayoutError[] } {
  const candidates: LayoutEntry[] = [];
  const errors: LayoutError[] = [];
  for (const path of [...paths].sort(byteOrder)) {
    const r =
      variantsOn && path.startsWith(`${VARIANTS_DIR}/`)
        ? classifyVariant(path, kindDirs)
        : classifyOne(path, kindDirs);
    if (r === null) continue;
    if ("reason" in r) errors.push(r);
    else candidates.push(r);
  }
  const count = new Map<string, number>();
  for (const e of candidates) count.set(keyOf(e), (count.get(keyOf(e)) ?? 0) + 1);
  const kept: LayoutEntry[] = [];
  for (const e of candidates) {
    if ((count.get(keyOf(e)) ?? 0) > 1) errors.push({ path: e.path, reason: "duplicate_id" });
    else kept.push(e);
  }
  return { candidates, kept, errors };
}

/** `variants/<name>/<rest>`: `rest` classified like a module path, under the variant `name`. */
function classifyVariant(
  path: string,
  kindDirs: ReadonlySet<string>,
): LayoutEntry | LayoutError | null {
  const segs = path.split("/");
  if (segs.length < 3) return null;
  const name = segs[1]!;
  const r = classifyOne(segs.slice(2).join("/"), kindDirs);
  if (r === null) return null;
  if ("reason" in r) return { path, reason: r.reason };
  if (!FOLDER_RE.test(name)) return { path, reason: "invalid_variant" };
  return { ...r, path, variant: name };
}

/** The file of a Document, relative to the module folder. */
export function documentPath(dir: string, id: string, folder?: string): string {
  return folder ? `${folder}/${dir}/${id}${YAML_EXT}` : `${dir}/${id}${YAML_EXT}`;
}
