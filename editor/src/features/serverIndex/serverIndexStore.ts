import type { Project } from "@/domain/types";
import { create } from "zustand";
import type { ServerProjectsResult } from "./serverIndexLoader";

interface ServerIndexState {
  /** `<network>/<server>` as the URL names them; `null` = nothing loaded. */
  scope: string | null;
  status: "idle" | "loading" | ServerProjectsResult["status"];
  projects: Project[];
  failed: string[];
  begin: (scope: string) => void;
  finish: (scope: string, result: ServerProjectsResult) => void;
  reset: () => void;
}

export const serverIndexScope = (serverId: string): string => serverId;

/**
 * The current server's published projects, read-only. Ephemeral: nothing is
 * persisted, the hub and the loader's cache serve the next visit.
 */
export const useServerIndexStore = create<ServerIndexState>((set, get) => ({
  scope: null,
  status: "idle",
  projects: [],
  failed: [],
  // Another server must never show the previous one's projects.
  begin: (scope) =>
    set(
      get().scope === scope
        ? { status: "loading" }
        : { scope, status: "loading", projects: [], failed: [] },
    ),
  finish: (scope, result) => {
    if (get().scope !== scope) return;
    set({ status: result.status, projects: result.projects, failed: result.failed });
  },
  reset: () => set({ scope: null, status: "idle", projects: [], failed: [] }),
}));
