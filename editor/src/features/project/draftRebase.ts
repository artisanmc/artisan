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
