import { create } from "zustand";

/**
 * The **base** of each open Project: the rel-keyed content of the files as
 * they were read from the server's disk (ADR `server-disk-only-storage`).
 *
 * It is the compare-and-swap reference: a save compares the current tree to
 * this base to send only the delta, and makes each entry carry the hash of
 * what it expected on disk. A successful save becomes the new base; a conflict
 * does not touch it — nothing was written, the base stays what was loaded.
 *
 * Kept out of the projects store on purpose: this is not domain, it is sync
 * bookkeeping, and it must not travel through undo/redo.
 */
interface ProjectBaselineState {
  binaryBaselines: Record<string, Record<string, { hash: string; size: number }>>;
  setBinaries: (projectId: string, files: Record<string, { hash: string; size: number }>) => void;
  /** projectId → { relPath: contenu }. */
  baselines: Record<string, Record<string, string>>;
  set: (projectId: string, files: Record<string, string>) => void;
  get: (projectId: string) => Record<string, string> | undefined;
  clear: (projectId: string) => void;
}

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const k of keysA) if (a[k] !== b[k]) return false;
  return true;
}

export const useProjectBaselineStore = create<ProjectBaselineState>()((set, get) => ({
  baselines: {},
  binaryBaselines: {},
  setBinaries: (projectId, files) =>
    set((state) => ({ binaryBaselines: { ...state.binaryBaselines, [projectId]: files } })),
  /**
   * Sets the base — KEEPING the previous object if the content has not moved.
   *
   * This object's identity is read as "is it the same load?" (`useDraftSync`).
   * A new object with identical content therefore looked like a new load: the
   * sync re-froze `initialTree` on the current tree, declared the draft CLEAN
   * while it held unsaved work, and that work was thrown away on the next
   * reload.
   *
   * Harmless while the base was only set on open; systematic since every
   * revalidation sets it. The content decides, not the reference.
   */
  set: (projectId, files) =>
    set((s) => {
      const current = s.baselines[projectId];
      if (current && sameFiles(current, files)) return s;
      return { baselines: { ...s.baselines, [projectId]: files } };
    }),
  get: (projectId) => get().baselines[projectId],
  clear: (projectId) =>
    set((s) => {
      const next = { ...s.baselines };
      delete next[projectId];
      const binaryBaselines = { ...s.binaryBaselines };
      delete binaryBaselines[projectId];
      return { baselines: next, binaryBaselines };
    }),
}));
