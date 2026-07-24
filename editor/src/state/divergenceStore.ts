import type { ProjectDivergence } from "@/lib/api/userProjects";
import { create } from "zustand";

/**
 * Pending disk↔web divergences by projectId (files-first P3c). Populated by
 * the project loader (the GET carries the per-file detail while the plugin's
 * report is pending); cleared on resolution. The plugin re-reports at every
 * hello_ack, so a missed report self-heals on the next project load.
 */
interface DivergenceState {
  byProject: Record<string, ProjectDivergence | undefined>;
  set(projectId: string, divergence: ProjectDivergence | undefined): void;
  clear(projectId: string): void;
}

export const useDivergenceStore = create<DivergenceState>((set) => ({
  byProject: {},
  set(projectId, divergence) {
    set((s) => ({ byProject: { ...s.byProject, [projectId]: divergence } }));
  },
  clear(projectId) {
    set((s) => ({ byProject: { ...s.byProject, [projectId]: undefined } }));
  },
}));
