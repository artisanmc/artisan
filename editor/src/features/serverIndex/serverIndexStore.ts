import type { Project } from "@/domain/types";
import { create } from "zustand";
import type { ServerProjectsResult } from "./serverIndexLoader";

interface ServerIndexState {
  /** `<network>/<server>` tels que l'URL les nomme ; `null` = rien chargé. */
  scope: string | null;
  status: "idle" | "loading" | ServerProjectsResult["status"];
  projects: Project[];
  failed: string[];
  begin: (scope: string) => void;
  finish: (scope: string, result: ServerProjectsResult) => void;
  reset: () => void;
}

export const serverIndexScope = (networkId: string, serverId: string): string =>
  `${networkId}/${serverId}`;

/**
 * Les projects publiés du serveur courant, en lecture seule. Éphémère : rien
 * n'est persisté, le backend et le cache du chargeur servent la visite suivante.
 */
export const useServerIndexStore = create<ServerIndexState>((set, get) => ({
  scope: null,
  status: "idle",
  projects: [],
  failed: [],
  // Un autre serveur ne doit jamais montrer les projects du précédent.
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
