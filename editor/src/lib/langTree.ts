// Project lang files are authored as YAML trees (`menus:` → `<menu_id>:` → …)
// but the runtime addresses translations by dotted key. These two functions are
// the codec between the two, and the Kotlin mirror is
// `plugin/…/yaml/LangFlattener.kt` — the shared vector
// `testdata/lang-tree-conformance.json` locks them together.

type LangTree = Record<string, unknown>;

const isBranch = (v: unknown): v is LangTree =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * YAML tree → dotted key map. Tolerant by design (ADR files-first): a file may
 * be fully nested, still flat, or any mix — a dotted key sitting inside a
 * branch just extends the path. Non-string scalars coerce (a `1.21` value is a
 * translation, not a float); `null` is the "" sentinel; lists are skipped.
 */
export function flattenLangTree(tree: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  walk(tree, "", out);
  return out;
}

function walk(node: unknown, path: string, out: Record<string, string>): void {
  if (Array.isArray(node)) return;
  if (node === null || node === undefined) {
    if (path) out[path] = "";
    return;
  }
  if (typeof node === "object") {
    for (const [seg, child] of Object.entries(node as LangTree)) {
      walk(child, path ? `${path}.${seg}` : seg, out);
    }
    return;
  }
  if (path) out[path] = String(node);
}

/**
 * Dotted key map → YAML tree, the canonical on-disk form. Keys are visited in
 * byte order so every level is deterministic (lang files are hashed).
 *
 * A key whose path is blocked by an existing leaf — `a.b` and `a.b.c` cannot
 * both nest — stays a dotted key at the root rather than being dropped. Byte
 * order makes which one wins deterministic: the shorter path nests.
 */
export function nestLangTree(flat: Record<string, string>): LangTree {
  const root: LangTree = {};
  const blocked: Array<[string, string]> = [];

  for (const key of Object.keys(flat).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const value = flat[key] ?? "";
    const segs = key.split(".");
    let cur: LangTree = root;
    let ok = true;
    for (const seg of segs.slice(0, -1)) {
      const next = cur[seg];
      if (next === undefined) {
        const child: LangTree = {};
        cur[seg] = child;
        cur = child;
      } else if (isBranch(next)) {
        cur = next;
      } else {
        ok = false;
        break;
      }
    }
    const last = segs[segs.length - 1] ?? key;
    if (!ok || cur[last] !== undefined) {
      blocked.push([key, value]);
      continue;
    }
    cur[last] = value;
  }

  for (const [key, value] of blocked) root[key] = value;
  return root;
}
