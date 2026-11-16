import { sameYamlValue } from "@/lib/yamlEquivalence";
import { isYamlPath, yamlPathOnDisk } from "@/lib/yamlFiles";

type Meta = { hash: string; size: number };

/**
 * Minimal shape shared by the hub snapshot (`DraftSnapshot`) and the editor
 * draft (`ProjectDraft`): the rebase only knows the text tree, the images and
 * the renames.
 */
export interface DraftRebaseShape {
  baseline: Record<string, string>;
  tree: Record<string, string>;
  renames?: { from: string; to: string }[];
  binaryBaseline?: Record<string, Meta>;
  binaryTree?: Record<string, Meta>;
}

/**
 * Rebases a draft on a "current" state, file by file (ADR
 * `snapshot-mirror-and-backend-history`, decision 5):
 * - changed only on the current side → the draft takes the current version;
 * - changed on both sides, differently → conflict, the draft keeps its own
 *   and its base stays the old one;
 * - identical on both sides → the base moves forward.
 * A path touched by one of the draft's renames belongs to it: left alone.
 *
 * Single source: the hub rebases against the published disk (`current` = the
 * Snapshot's files), the editor against another session's draft; the
 * algorithm is the same, only `current` changes.
 */
export function rebaseDraft<S extends DraftRebaseShape>(
  snapshot: S,
  current: { files: Record<string, string>; binaries: Record<string, Meta> },
): { snapshot: S; conflicts: { path: string; disk: string | null }[] } {
  const renamed = new Set((snapshot.renames ?? []).flatMap((r) => [r.from, r.to]));
  const conflicts: string[] = [];
  const text = rebaseMap(
    snapshot.baseline,
    snapshot.tree,
    current.files,
    (a, b) => a === b,
    renamed,
    conflicts,
  );
  // Conflicting images are left to publication (CAS): no diff to show.
  const binaryConflicts: string[] = [];
  const binary =
    snapshot.binaryBaseline || snapshot.binaryTree
      ? rebaseMap(
          snapshot.binaryBaseline ?? {},
          snapshot.binaryTree ?? snapshot.binaryBaseline ?? {},
          current.binaries,
          (a, b) => a.hash === b.hash,
          renamed,
          binaryConflicts,
        )
      : null;
  const next = { ...snapshot };
  next.baseline = text.baseline;
  next.tree = text.tree;
  // A draft without image tracking lets the editor read them from the source.
  if (binary) {
    next.binaryBaseline = binary.baseline;
    next.binaryTree = binary.tree;
  }
  return {
    snapshot: next,
    conflicts: conflicts.sort().map((path) => ({ path, disk: current.files[path] ?? null })),
  };
}

function rebaseMap<T>(
  baseline: Record<string, T>,
  tree: Record<string, T>,
  current: Record<string, T>,
  same: (a: T, b: T) => boolean,
  renamed: Set<string>,
  conflicts: string[],
) {
  const eq = (a: T | undefined, b: T | undefined) =>
    a === undefined || b === undefined ? a === b : same(a, b);
  const nextBaseline = { ...baseline };
  const nextTree = { ...tree };
  for (const path of new Set([
    ...Object.keys(baseline),
    ...Object.keys(tree),
    ...Object.keys(current),
  ])) {
    if (renamed.has(path)) continue;
    const base = baseline[path];
    const mine = tree[path];
    const theirs = current[path];
    if (eq(base, theirs)) continue;
    if (eq(base, mine)) {
      assign(nextTree, path, theirs);
      assign(nextBaseline, path, theirs);
    } else if (eq(mine, theirs)) {
      assign(nextBaseline, path, theirs);
    } else {
      conflicts.push(path);
    }
  }
  return { baseline: nextBaseline, tree: nextTree };
}

function assign<T>(target: Record<string, T>, path: string, value: T | undefined) {
  if (value === undefined) delete target[path];
  else target[path] = value;
}

/**
 * Brings a resumed draft up to the disk it reopens on: a file the disk changed, added or
 * removed since the draft's base, and that the draft left as it loaded it, takes the disk's
 * version, base included. A module that removes or rewrites one of its files at startup, or
 * another tool writing the folder, no longer leaves the draft showing (and later publishing)
 * the old file. A file the draft did change stays the draft's: publishing reports it.
 *
 * "Left as loaded" is measured against `initialTree` (the tree right after opening), not
 * the base's bytes: opening reformats files nobody touched. A file the draft deleted stays
 * deleted whatever the disk did to it. Returns null when nothing moved.
 */
export function followDisk<S extends DraftRebaseShape & { initialTree?: Record<string, string> }>(
  resumed: S,
  disk: Record<string, string>,
): S | null {
  const draft = spelledAsDisk(resumed, disk);
  const renamed = new Set((draft.renames ?? []).flatMap((r) => [r.from, r.to]));
  const loaded = draft.initialTree ?? draft.baseline;
  const baseline = { ...draft.baseline };
  const tree = { ...draft.tree };
  const initialTree = draft.initialTree ? { ...draft.initialTree } : undefined;
  let moved = false;
  for (const path of new Set([...Object.keys(draft.baseline), ...Object.keys(disk)])) {
    if (renamed.has(path) || draft.baseline[path] === disk[path]) continue;
    if (!sameText(path, draft.tree[path], loaded[path])) {
      // Edited to what the disk now holds: nothing left to merge, the base catches up.
      if (draft.tree[path] !== undefined && sameText(path, draft.tree[path], disk[path])) {
        assign(baseline, path, disk[path]);
        moved = true;
      }
      continue;
    }
    // A file the draft deleted, in this session or an earlier one (in its base, not in its
    // tree), stays deleted: a category moved into a folder must not come back at the root
    // when the disk rewrites the file it was moved from.
    if (draft.tree[path] === undefined && draft.baseline[path] !== undefined) {
      if (disk[path] !== undefined) continue;
      assign(baseline, path, undefined);
      moved = true;
      continue;
    }
    assign(baseline, path, disk[path]);
    assign(tree, path, disk[path]);
    if (initialTree) assign(initialTree, path, disk[path]);
    moved = true;
  }
  if (!moved && draft === resumed) return null;
  return { ...draft, baseline, tree, ...(initialTree ? { initialTree } : {}) };
}

/**
 * The files a draft (already through [followDisk]) and the disk both changed since the draft's
 * base, each its own way: the three-way merge cannot pick, the admin does (the conflict modal,
 * source "open"). Until then the draft keeps its version and its base, so publishing it is
 * refused (compare-and-swap) instead of overwriting the server's change.
 *
 * A file the draft deleted is left to publishing, as [followDisk] leaves it: a module that
 * rewrites a file the draft moved away would otherwise ask at every start. Renamed paths belong
 * to the draft. A YAML file holding the same value on both sides is no conflict.
 */
export function diskConflicts(
  draft: DraftRebaseShape,
  disk: Record<string, string>,
): { path: string; disk: string | null }[] {
  const renamed = new Set((draft.renames ?? []).flatMap((r) => [r.from, r.to]));
  const out: { path: string; disk: string | null }[] = [];
  for (const path of new Set([...Object.keys(draft.baseline), ...Object.keys(disk)])) {
    if (renamed.has(path)) continue;
    const base = draft.baseline[path];
    const mine = draft.tree[path];
    const theirs = disk[path];
    if (mine === undefined || base === theirs) continue;
    if (sameText(path, mine, base) || sameText(path, mine, theirs)) continue;
    out.push({ path, disk: theirs ?? null });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The base to save a draft's [tree] against, when the editor's base ([current], the baseline
 * store) may have moved past the draft's own ([previous]): a file's base moves forward only if
 * the tree already holds the new base, or the draft's base already did. Otherwise the draft keeps
 * the base its tree was built on, and publishing reports the server's change as a conflict
 * instead of overwriting it.
 *
 * Without this, a tab still showing an older tree, whose base was refreshed by a reload (another
 * tab discarded or published, the server's files changed), saved and deployed that old tree
 * against the new base: the compare-and-swap passed and the server's change was erased.
 */
export function pairedBaseline(
  previous: Record<string, string> | undefined,
  current: Record<string, string>,
  tree: Record<string, string>,
): Record<string, string> {
  if (!previous) return current;
  let out: Record<string, string> | null = null;
  for (const path of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const next = current[path];
    const before = previous[path];
    if (next === before || sameText(path, tree[path], next)) continue;
    out ??= { ...current };
    assign(out, path, before);
  }
  return out ?? current;
}

/** Same text, or the same YAML value: the editor writes Documents in its own format. */
function sameText(path: string, a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a === b || (isYamlPath(path) && sameYamlValue(a, b));
}

/**
 * The draft's YAML paths as the disk spells them: a draft started before its
 * folder moved to `.yml` names `menus/shop.yaml` where the disk now holds
 * `menus/shop.yml` (and `manifest.yaml` where it holds `artisan-module.yml`).
 * Without this, the draft would delete the old name and add the new one, and
 * lose an edit made under the old name.
 *
 * A draft that already holds both spellings (an older resume took the disk's new
 * file beside the old one) is folded onto the disk's: the same id twice is a
 * `duplicate_id`, and the editor reads neither, so the menus vanished. Each map
 * keeps the old name's text where the draft edited it (it differs from the base)
 * and the new name's otherwise.
 */
function spelledAsDisk<S extends DraftRebaseShape & { initialTree?: Record<string, string> }>(
  draft: S,
  disk: Record<string, string>,
): S {
  const held = new Set([...Object.keys(draft.baseline), ...Object.keys(draft.tree)]);
  const moves = new Map<string, string>();
  for (const path of held) {
    const onDisk = yamlPathOnDisk(path, disk);
    if (onDisk !== path) moves.set(path, onDisk);
  }
  if (moves.size === 0) return draft;
  const as = (path: string) => moves.get(path) ?? path;
  const edited = (path: string) => draft.tree[path] !== draft.baseline[path];
  const remap = (files: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [path, text] of Object.entries(files)) {
      const to = as(path);
      if (to === path) {
        // The disk's name, unless the old one carries the draft's edit.
        const old = [...moves].find(([, target]) => target === path)?.[0];
        if (old !== undefined && old in files && edited(old) && !edited(path)) continue;
        out[path] = text;
      } else if (!(to in files) || (edited(path) && !edited(to))) {
        out[to] = text;
      }
    }
    return out;
  };
  const renames = draft.renames
    ?.map((r) => ({ from: as(r.from), to: as(r.to) }))
    .filter((r) => r.from !== r.to);
  return {
    ...draft,
    baseline: remap(draft.baseline),
    tree: remap(draft.tree),
    ...(draft.initialTree ? { initialTree: remap(draft.initialTree) } : {}),
    ...(renames ? { renames } : {}),
  };
}
