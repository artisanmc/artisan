/** A Project working copy and its server baseline. Draft persistence is separate from publication. */
/** A rename declared by the editor, in relative paths. */
export interface PendingRename {
  from: string;
  to: string;
}

export interface ProjectDraft {
  binaryBaseline?: Record<string, { hash: string; size: number }>;
  binaryTree?: Record<string, { hash: string; size: number }>;
  /** The Version this draft was restored from: the Version its publication makes says so. */
  restoredFrom?: string;
  remote?: {
    id: string;
    name: string;
    revision: number;
    ownerId: string;
    acknowledged?: string;
    /**
     * The tree of the acknowledged revision: the last common point with other
     * sessions, against which their work is merged. Distinct from `baseline`,
     * which stays the published disk.
     */
    base?: {
      tree: Record<string, string>;
      binaryTree?: Record<string, { hash: string; size: number }>;
    };
    pendingMutation?: {
      operationId: string;
      kind: "save" | "copy" | "publish" | "discard" | "asset";
      asset?: {
        suffix: string;
        method: string;
        fields: Record<string, string>;
        file?: { name: string; type: string; base64: string };
      };
      id: string;
      revision: number;
      name: string;
      snapshot?: ProjectDraft;
    };
  };
  /** The tree as the server loaded it, rel-keyed. */
  baseline: Record<string, string>;
  /** The tree as the editor shows it — what a save will send. */
  tree: Record<string, string>;
  /**
   * The tree **right after loading**, before any edit.
   *
   * This, not the server's bytes, answers "did you change anything?". Opening a
   * Project applies transformations — injecting declared models, dropping a
   * legacy source, canonical formatting of a hand-written file — that
   * legitimately make the tree differ from the disk bytes **without anyone
   * touching anything**. Comparing to the bytes would report "unsaved work" on a
   * Project just opened.
   */
  initialTree?: Record<string, string>;
  /** Millis when the base was taken: the draft's age, for display. */
  at: number;
  /**
   * Renames declared since the last save.
   *
   * Persisted with the draft on purpose: the tree already carries the new name,
   * so losing this list on a reload would turn the rename back into
   * "delete + create" — losing the file's trash and history with it.
   */
  renames?: PendingRename[];
}

/**
 * Is there unsaved work?
 *
 * Content comparison, **no hashing**: this indicator is permanent, it must be
 * free. Hashing only happens on save, where it serves something else —
 * checking the disk has not moved.
 */
export function isDirty(
  reference: Record<string, string> | undefined,
  tree: Record<string, string>,
): boolean {
  const base = reference ?? {};
  const baseKeys = Object.keys(base);
  const treeKeys = Object.keys(tree);
  if (baseKeys.length !== treeKeys.length) return true;
  return treeKeys.some((k) => base[k] !== tree[k]);
}

export function hasDraftChanges(draft: ProjectDraft): boolean {
  if (isDirty(draft.initialTree, draft.tree)) return true;
  const baseline = draft.binaryBaseline ?? {};
  const tree = draft.binaryTree ?? {};
  return (
    Object.keys(baseline).length !== Object.keys(tree).length ||
    Object.entries(tree).some(
      ([path, value]) => value.hash !== baseline[path]?.hash || value.size !== baseline[path]?.size,
    )
  );
}

/**
 * The draft's age, in a readable unit.
 *
 * Rounding to whole hours produced "based on the state from 0 h ago" for a
 * ten-minute draft — a meaningless sentence that looks like a broken counter.
 */
export type DraftAge =
  | { unit: "now"; value: 0 }
  | { unit: "minutes"; value: number }
  | { unit: "hours"; value: number }
  | { unit: "days"; value: number };

export function draftAge(at: number, now: number = Date.now()): DraftAge {
  const ms = Math.max(0, now - at);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return { unit: "now", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: "hours", value: hours };
  return { unit: "days", value: Math.floor(hours / 24) };
}
