import { parse } from "yaml";
import { isYamlPath } from "./yamlFiles";

/** Pairs already compared, by `disk\0written`: a save compares the same unedited files again and again. */
const known = new Map<string, boolean>();
const KNOWN_MAX = 4000;

/**
 * Do `a` and `b` hold the same YAML value? Formatting, quoting, flow or block style, key
 * order, comments and line endings (CRLF from a file written on Windows) do not count.
 * Unreadable YAML is never the same.
 */
export function sameYamlValue(a: string, b: string): boolean {
  if (a === b) return true;
  const key = `${a}\u0000${b}`;
  const hit = known.get(key);
  if (hit !== undefined) return hit;
  let same = false;
  try {
    same = canonicalJson(parse(a)) === canonicalJson(parse(b));
  } catch {
    same = false;
  }
  if (known.size >= KNOWN_MAX) known.clear();
  known.set(key, same);
  return same;
}

/**
 * `tree` with each YAML file whose value is the one `disk` holds written back as `disk`
 * has it, byte for byte. The editor writes every Document in its canonical form; a file it
 * read and did not change must not come back reformatted: a deploy would otherwise list,
 * and rewrite, every hand-written or module-shipped file as modified. An edited file keeps
 * the disk's CRLF line endings, so its diff shows the edit and not every line.
 */
export function keepEquivalentText(
  tree: Record<string, string>,
  disk: Record<string, string> | undefined,
): Record<string, string> {
  if (!disk) return tree;
  let out: Record<string, string> | null = null;
  for (const [path, content] of Object.entries(tree)) {
    const onDisk = disk[path];
    if (onDisk === undefined || onDisk === content || !isYamlPath(path)) continue;
    const kept = sameYamlValue(onDisk, content) ? onDisk : withLineEndingsOf(onDisk, content);
    if (kept === content) continue;
    out ??= { ...tree };
    out[path] = kept;
  }
  return out ?? tree;
}

/** [content] in CRLF when [disk] is: the editor writes LF. */
function withLineEndingsOf(disk: string, content: string): string {
  if (!disk.includes("\r\n") || content.includes("\r")) return content;
  return content.replace(/\n/g, "\r\n");
}

/** JSON with every map's keys sorted: two values that differ only by key order give one string. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
}
