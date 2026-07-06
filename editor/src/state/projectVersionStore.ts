import { create } from "zustand";

/**
 * Optimistic-concurrency bookkeeping for project saves. Lives OUTSIDE the
 * account store on purpose: versions track what the *server* holds, so they
 * must survive undo/redo (zundo) untouched.
 *
 * `versions` — last version loaded from or acknowledged by the backend.
 * `conflicts` — projects whose last save was rejected with 409: another
 * writer (other tab/admin, plugin push, deploy) advanced the version. While
 * flagged, auto-save skips the project and the UI shows a reload banner.
 */
interface ProjectVersionState {
  versions: Record<string, number>;
  conflicts: Record<string, boolean>;
  setVersion: (projectId: string, version: number) => void;
  /** Fresh-load sync: records versions AND lifts conflict flags for those ids
   *  (a reload picked up the server state, so the conflict is resolved). */
  setVersions: (entries: Record<string, number>) => void;
  markConflict: (projectId: string) => void;
  clearConflict: (projectId: string) => void;
}

export const useProjectVersionStore = create<ProjectVersionState>()((set) => ({
  versions: {},
  conflicts: {},
  setVersion: (projectId, version) =>
    set((s) => ({ versions: { ...s.versions, [projectId]: version } })),
  setVersions: (entries) =>
    set((s) => {
      const conflicts = { ...s.conflicts };
      for (const id of Object.keys(entries)) delete conflicts[id];
      return { versions: { ...s.versions, ...entries }, conflicts };
    }),
  markConflict: (projectId) =>
    set((s) => ({ conflicts: { ...s.conflicts, [projectId]: true } })),
  clearConflict: (projectId) =>
    set((s) => {
      const { [projectId]: _, ...rest } = s.conflicts;
      return { conflicts: rest };
    }),
}));

export class VersionConflictError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly currentVersion: number,
  ) {
    super(`Project ${projectId} was modified elsewhere (server version ${currentVersion})`);
    this.name = "VersionConflictError";
  }
}
