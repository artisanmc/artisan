import type { Project } from "@/domain/types";
import { kitProjectAmong } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { create } from "zustand";
import type { ServerProjectsResult } from "./serverIndexLoader";

interface ServerIndexState {
  /** `<network>/<server>` as the URL names them; `null` = nothing loaded. */
  scope: string | null;
  status: "idle" | "loading" | ServerProjectsResult["status"];
  projects: Project[];
  failed: string[];
  /** The raw reads behind `projects`, for the open-cache (`seedProjectCache`). */
  reads: NonNullable<ServerProjectsResult["reads"]>;
  /**
   * A folder of the sidebar was unfolded while nothing read the index (a server
   * page reads it only for its search): the sidebar's own loader reads it then.
   */
  requested: boolean;
  request: () => void;
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
  reads: [],
  requested: false,
  request: () => {
    if (!get().requested) set({ requested: true });
  },
  // Another server must never show the previous one's projects.
  begin: (scope) =>
    set(
      get().scope === scope
        ? { status: "loading" }
        : { scope, status: "loading", projects: [], failed: [], reads: [] },
    ),
  finish: (scope, result) => {
    if (get().scope !== scope) return;
    set({
      status: result.status,
      projects: result.projects,
      failed: result.failed,
      reads: result.reads ?? [],
    });
  },
  reset: () =>
    set({ scope: null, status: "idle", projects: [], failed: [], reads: [], requested: false }),
}));

// The published files of the common images' Project (the theme `artisan`), for whatever draws a `kit:<name>` image (`state/kitStore`).
useServerIndexStore.subscribe((state, previous) => {
  if (state.reads === previous.reads) return;
  const folderOf = (r: (typeof state.reads)[number]) => r.summary.externalId ?? r.summary.id;
  const read = kitProjectAmong(state.reads, folderOf);
  useKitStore.getState().setRead(
    read && {
      projectId: read.summary.id,
      files: read.files,
      binaries: read.binaries,
      byName: read.summary.role === "theme",
    },
  );
  // The server's other themes, each a Project of its name (`lib/pack/theme.ts`).
  useKitStore.getState().setOwn(
    Object.fromEntries(
      state.reads
        .filter((r) => r.summary.role === "theme" && r !== read)
        .map((r) => [
          folderOf(r),
          {
            projectId: r.summary.id,
            files: r.files,
            binaries: r.binaries,
            canMove: r.summary.capabilities?.canRename === true,
          },
        ]),
    ),
  );
});
