import type { ProjectFileConflict } from "@/lib/api/projectFiles";

export type ConflictChoice = "mine" | "disk";

export interface ResolutionOutcome {
  /** The base to install before re-saving. */
  nextBaseline: Record<string, string>;
  /** Disk contents to bring back into the editor's tree ("disk" choice). */
  adoptFromDisk: Record<string, string>;
  /** Paths to remove from the editor's tree (deleted on disk, "disk" choice). */
  removeFromTree: string[];
  /** Conflicts left without a choice — the caller must not save while any remain. */
  unresolved: string[];
}

/**
 * Turns the admin's choices into a single gesture: **adopt the disk content
 * as the base** (ADR `server-disk-only-storage`).
 *
 * This makes both options symmetric with no special case:
 * - "keep mine" → only the base moves, so the re-save carries the token the
 *   plugin expects and legitimately overwrites;
 * - "take the server's" → the base *and* the editor's tree move, so nothing
 *   is left to write for that file.
 *
 * A file without a choice is not decided for the admin: it comes out in
 * `unresolved`, and saving stays blocked. Same rule as on the plugin side — a
 * silent default on contested data is data loss disguised as ergonomics.
 */
export function applyResolutions(
  baseline: Record<string, string>,
  conflicts: ProjectFileConflict[],
  choices: Record<string, ConflictChoice>,
): ResolutionOutcome {
  const nextBaseline = { ...baseline };
  const adoptFromDisk: Record<string, string> = {};
  const removeFromTree: string[] = [];
  const unresolved: string[] = [];

  for (const conflict of conflicts) {
    const choice = choices[conflict.path];
    if (!choice) {
      unresolved.push(conflict.path);
      continue;
    }
    // Either way the base matches the disk: that is what we now know is there.
    // `null` (file deleted on disk) is represented by the absence of an entry —
    // the same as "new file", so one mechanism covers both.
    if (conflict.disk === null) delete nextBaseline[conflict.path];
    else nextBaseline[conflict.path] = conflict.disk;

    if (choice === "disk") {
      if (conflict.disk === null) removeFromTree.push(conflict.path);
      else adoptFromDisk[conflict.path] = conflict.disk;
    }
  }

  return { nextBaseline, adoptFromDisk, removeFromTree, unresolved };
}
