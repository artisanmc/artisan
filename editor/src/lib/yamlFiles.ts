/**
 * The two YAML extensions a module's files may carry: `.yml`, the Bukkit/Paper
 * norm, and `.yaml`, what Artisan wrote before. Both are read; `<stem>.yml`
 * and `<stem>.yaml` side by side are one file twice: a Document is refused
 * (`duplicate_id`), any other file is read from its `.yml` copy.
 *
 * Mirror of the plugin's `model/YamlFiles.kt`.
 */
export const YAML_EXTENSIONS = [".yml", ".yaml"] as const;

export function isYamlPath(path: string): boolean {
  return YAML_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** `path` without its YAML extension, or `null` when it has none. */
export function yamlStem(path: string): string | null {
  const ext = YAML_EXTENSIONS.find((e) => path.endsWith(e));
  return ext ? path.slice(0, -ext.length) : null;
}

/** `<stem>.yml`, else `<stem>.yaml`, among `has`'s paths; `null` when neither. */
export function findYaml(stem: string, has: (path: string) => boolean): string | null {
  for (const ext of YAML_EXTENSIONS) if (has(stem + ext)) return stem + ext;
  return null;
}

/** The file that makes a folder a module (`schema: module/v1`), then the names it had before. */
export const MODULE_FILE = "artisan-module.yml";
export const MODULE_FILE_NAMES = [MODULE_FILE, "manifest.yml", "manifest.yaml"] as const;

export function isModuleFile(path: string): boolean {
  return (MODULE_FILE_NAMES as readonly string[]).includes(path);
}

/**
 * The YAML files among `paths` right under `prefix` (no deeper), by stem; a
 * stem held twice is read from its `.yml` copy. Sorted by stem.
 */
export function yamlFilesUnder(
  paths: Iterable<string>,
  prefix: string,
): [stem: string, path: string][] {
  const out = new Map<string, string>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const stem = yamlStem(path.slice(prefix.length));
    if (stem === null || stem.includes("/")) continue;
    const held = out.get(stem);
    if (held === undefined || path.endsWith(".yml")) out.set(stem, path);
  }
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `path`, or its other-extension twin when only that one is in `disk`. */
export function yamlPathOnDisk(path: string, disk: Record<string, unknown>): string {
  if (path in disk) return path;
  const stem = yamlStem(path);
  if (stem === null) return path;
  const twin = stem + (path.endsWith(".yml") ? ".yaml" : ".yml");
  return twin in disk ? twin : path;
}

/**
 * `tree` with each YAML file that `disk` holds under its other extension
 * written back under that name: a save never turns `menus/shop.yml` into a
 * new `menus/shop.yaml` beside a deleted one.
 */
export function keepYamlExtensions<T>(
  tree: Record<string, T>,
  disk: Record<string, unknown> | undefined,
): Record<string, T> {
  if (!disk) return tree;
  const out: Record<string, T> = {};
  for (const [path, content] of Object.entries(tree)) {
    const onDisk = yamlPathOnDisk(path, disk);
    out[onDisk in tree && onDisk !== path ? path : onDisk] = content;
  }
  return out;
}
