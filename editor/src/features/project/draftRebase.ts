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
 * the base's bytes: opening reformats files nobody touched. Returns null when nothing moved.
 */
export function followDisk<S extends DraftRebaseShape & { initialTree?: Record<string, string> }>(
  draft: S,
  disk: Record<string, string>,
): S | null {
  const renamed = new Set((draft.renames ?? []).flatMap((r) => [r.from, r.to]));
  const loaded = draft.initialTree ?? draft.baseline;
  const baseline = { ...draft.baseline };
  const tree = { ...draft.tree };
  const initialTree = draft.initialTree ? { ...draft.initialTree } : undefined;
  let moved = false;
  for (const path of new Set([...Object.keys(draft.baseline), ...Object.keys(disk)])) {
    if (renamed.has(path) || draft.baseline[path] === disk[path]) continue;
    if (draft.tree[path] !== loaded[path]) continue;
    assign(baseline, path, disk[path]);
    assign(tree, path, disk[path]);
    if (initialTree) assign(initialTree, path, disk[path]);
    moved = true;
  }
  if (!moved) return null;
  return { ...draft, baseline, tree, ...(initialTree ? { initialTree } : {}) };
}
