import { sameYamlValue } from "@/lib/yamlEquivalence";
import { isYamlPath, yamlStem } from "@/lib/yamlFiles";
import { ORIGINALS_DIR } from "./documentLayout";

/**
 * The data a module ships (design `originaux-modules`): `originals/data/<id>.yml` and
 * `originals/models/<id>.yml` serve while the owner has no copy of their own, like a shipped
 * Document. The editor reads them at the owner's path (a source, a model beside it) and writes
 * the owner's copy only once it differs from the shipped one.
 *
 * Top-level files only: a per-row source folder (`data/<id>/`) is the owner's or nothing.
 */
const SHIPPED_DIRS = ["data", "models"] as const;

/** `data/<stem>` or `models/<stem>`, the stem without a folder; null otherwise. */
function shippedKey(rel: string): string | null {
  if (!isYamlPath(rel)) return null;
  const stem = yamlStem(rel);
  if (stem === null) return null;
  const [dir, name, ...rest] = stem.split("/");
  if (!SHIPPED_DIRS.includes(dir as (typeof SHIPPED_DIRS)[number]) || !name || rest.length > 0)
    return null;
  return `${dir}/${name}`;
}

/**
 * The owner's path of each shipped data or model file the owner has no copy of (neither
 * extension, nor a per-row folder of that name), mapped to its path under `originals/`.
 * Paths relative to the module folder.
 */
export function shippedDataFiles(paths: Iterable<string>): Map<string, string> {
  const all = [...paths];
  const owned = new Set<string>();
  for (const p of all) {
    if (p.startsWith(`${ORIGINALS_DIR}/`)) continue;
    const key = shippedKey(p);
    if (key) owned.add(key);
    // A per-row source folder covers the shipped file of the same name.
    const [dir, name, ...rest] = p.split("/");
    if (dir === "data" && name && rest.length > 0) owned.add(`data/${name}`);
  }
  const out = new Map<string, string>();
  for (const p of all) {
    if (!p.startsWith(`${ORIGINALS_DIR}/`)) continue;
    const rel = p.slice(ORIGINALS_DIR.length + 1);
    const key = shippedKey(rel);
    if (!key || owned.has(key)) continue;
    // `.yml` wins over `.yaml`, as everywhere a stem has both.
    if (!out.has(`${key}.yml`) || p.endsWith(".yml")) out.set(`${key}.yml`, p);
  }
  return out;
}

/** `files` (keyed `<base><rel>`) with the shipped data the owner has no copy of at the owner's path. */
export function withShippedData(
  files: Record<string, string>,
  base: string,
): Record<string, string> {
  const rels = Object.keys(files)
    .filter((k) => k.startsWith(base))
    .map((k) => k.slice(base.length));
  const shipped = shippedDataFiles(rels);
  if (shipped.size === 0) return files;
  const out = { ...files };
  for (const [owner, original] of shipped) out[`${base}${owner}`] = files[`${base}${original}`]!;
  return out;
}

/**
 * `tree` (relative paths, as written) without the data and model files the owner never had and
 * that still say what the module ships: the server's `originals/` keeps serving them.
 */
export function dropShippedData(
  tree: Record<string, string>,
  disk: Record<string, string> | undefined,
): Record<string, string> {
  if (!disk) return tree;
  const shipped = shippedDataFiles(Object.keys(disk));
  let out: Record<string, string> | null = null;
  for (const [path, content] of Object.entries(tree)) {
    if (path in disk) continue;
    const key = shippedKey(path);
    const original = key ? shipped.get(`${key}.yml`) : undefined;
    if (original === undefined || !sameYamlValue(disk[original]!, content)) continue;
    out ??= { ...tree };
    delete out[path];
  }
  return out ?? tree;
}
