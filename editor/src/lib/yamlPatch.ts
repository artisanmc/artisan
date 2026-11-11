import { type Document, isMap, isNode, isScalar, isSeq, parse, parseDocument } from "yaml";

/** Patches already computed, by `disk\0written`: a save patches the same edited files again and again. */
const known = new Map<string, string | null>();
const KNOWN_MAX = 2000;

/**
 * `disk` changed to hold the value `written` holds, in `disk`'s own text: only the values that
 * differ are rewritten, so flow maps, quotes, comments and key order stay as the file has them.
 * A new key or item takes the style of its parent. Null when `disk` cannot be patched (it does
 * not parse, its root is not a map or a list, or the patched text does not read back as
 * `written`): the caller writes `written` as is. Line endings are the caller's.
 */
export function patchYamlText(disk: string, written: string): string | null {
  const key = `${disk}\u0000${written}`;
  if (known.has(key)) return known.get(key) ?? null;
  let out: string | null = null;
  try {
    out = patch(disk.replace(/\r\n/g, "\n"), written);
  } catch {
    out = null;
  }
  if (known.size >= KNOWN_MAX) known.clear();
  known.set(key, out);
  return out;
}

function patch(disk: string, written: string): string | null {
  const doc = parseDocument(disk);
  if (doc.errors.length > 0 || !(isMap(doc.contents) || isSeq(doc.contents))) return null;
  const target: unknown = parse(written);
  doc.contents = apply(doc, doc.contents, target) as typeof doc.contents;
  const out = doc.toString({ lineWidth: 0 });
  return sameJson(parse(out), target) ? out : null;
}

/**
 * `node` holding `after`: the same node when its value already is, the node itself with only
 * what differs changed when both are maps, lists or scalars of one type (a scalar keeps its
 * quotes), else a new node.
 */
function apply(doc: Document, node: unknown, after: unknown): unknown {
  if (isNode(node) && sameJson(node.toJSON(), after)) return node;
  if (isMap(node) && isPlainObject(after)) {
    const seen = new Set<string>();
    node.items = node.items.filter((pair) => {
      const k = String(isScalar(pair.key) ? pair.key.value : pair.key);
      if (!Object.hasOwn(after, k) || seen.has(k)) return false;
      seen.add(k);
      pair.value = apply(doc, pair.value, after[k]);
      return true;
    });
    for (const [k, v] of Object.entries(after))
      if (!seen.has(k)) node.items.push(doc.createPair(k, v));
    return node;
  }
  if (isSeq(node) && Array.isArray(after)) {
    node.items = after.map((v, i) =>
      i < node.items.length ? apply(doc, node.items[i], v) : doc.createNode(v),
    );
    return node;
  }
  if (isScalar(node) && typeof node.value === typeof after && typeof after !== "object") {
    node.value = after;
    return node;
  }
  return doc.createNode(after);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Same value, map key order aside. */
function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!isPlainObject(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = v[k];
    return sorted;
  });
}
